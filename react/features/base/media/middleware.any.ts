import { AnyAction } from 'redux';
import { Buffer } from "buffer/";
// @ts-ignore
window.Buffer = Buffer;

import {
    createStartAudioOnlyEvent,
    createStartMutedConfigurationEvent,
    createSyncTrackStateEvent,
    createTrackMutedEvent
} from '../../analytics/AnalyticsEvents';
import { sendAnalytics } from '../../analytics/functions';
import { IStore } from '../../app/types';
import { MEDIA_TYPE as AVM_MEDIA_TYPE } from '../../av-moderation/constants';
import { isForceMuted } from '../../av-moderation/functions';
import { APP_STATE_CHANGED } from '../../mobile/background/actionTypes';
import { showWarningNotification } from '../../notifications/actions';
import { NOTIFICATION_TIMEOUT_TYPE } from '../../notifications/constants';
import { isScreenMediaShared } from '../../screen-share/functions';
import { SET_AUDIO_ONLY } from '../audio-only/actionTypes';
import { setAudioOnly } from '../audio-only/actions';
import { SET_ROOM } from '../conference/actionTypes';
import { isRoomValid } from '../conference/functions';
import { PARTICIPANT_MUTED_US } from '../participants/actionTypes';
import { getLocalParticipant } from '../participants/functions';
import MiddlewareRegistry from '../redux/MiddlewareRegistry';
import { getPropertyValue } from '../settings/functions.any';
import { TRACK_ADDED } from '../tracks/actionTypes';
import { CONNECTION_DISCONNECTED } from "../connection/actionTypes";
import { destroyLocalTracks } from '../tracks/actions.any';
import {
    getCameraFacingMode,
    isLocalTrackMuted,
    isLocalVideoTrackDesktop,
    setTrackMuted
} from '../tracks/functions.any';
import { ITrack } from '../tracks/types';
import { AudioRemoteSender } from "./AudioRemoteSender";

const audioRemoteSender = new AudioRemoteSender()

import {
    SET_AUDIO_MUTED,
    SET_AUDIO_UNMUTE_PERMISSIONS,
    SET_SCREENSHARE_MUTED,
    SET_VIDEO_MUTED,
    SET_VIDEO_UNMUTE_PERMISSIONS,
} from "./actionTypes";
import {
    setAudioMuted,
    setCameraFacingMode,
    setScreenshareMuted,
    setVideoMuted,
} from "./actions";
import {
    MEDIA_TYPE,
    SCREENSHARE_MUTISM_AUTHORITY,
    VIDEO_MUTISM_AUTHORITY,
    VIDEO_TYPE
} from './constants';
import { getStartWithAudioMuted, getStartWithVideoMuted } from './functions';
import logger from './logger';
import {
    _AUDIO_INITIAL_MEDIA_STATE,
    _VIDEO_INITIAL_MEDIA_STATE,
} from "./reducer";
import { PassThrough, Stream } from "stream-browserify";
import { EncodePcmStream } from "./EncodePCM";
import { CONNECTION_DISCONNECTED } from "../connection/actionTypes";
import { AudioRemoteSender } from "./AudioRemoteSender";

const audioRemoteSender = new AudioRemoteSender()

/**
 * Implements the entry point of the middleware of the feature base/media.
 *
 * @param {Store} store - The redux store.
 * @returns {Function}
 */
MiddlewareRegistry.register((store) => (next) => (action) => {
    switch (action.type) {
        case APP_STATE_CHANGED:
            return _appStateChanged(store, next, action);

    case CONNECTION_DISCONNECTED:
        audioRemoteSender.emitAudioClose()
        break

    case PARTICIPANT_MUTED_US: {
        const { dispatch } = store;
        const { track } = action;

        // Sync the media muted state with the track muted state.
        if (track.isAudioTrack()) {
            dispatch(setAudioMuted(true, /* ensureTrack */ false));
        } else if (track.isVideoTrack()) {
            if (track.getVideoType() === VIDEO_TYPE.DESKTOP) {
                dispatch(setScreenshareMuted(true, SCREENSHARE_MUTISM_AUTHORITY.USER, /* ensureTrack */ false));
            } else {
                dispatch(setVideoMuted(true, VIDEO_MUTISM_AUTHORITY.USER, /* ensureTrack */ false));
            }
        }

        break;
    }

    case SET_AUDIO_ONLY:
        return _setAudioOnly(store, next, action);

        case SET_ROOM:
            return _setRoom(store, next, action);

        case CONNECTION_DISCONNECTED:
            audioRemoteSender.emitAudioClose()
            break
        case TRACK_ADDED: {
            const result = next(action);
            const { track } = action;

            // Don't sync track mute state with the redux store for screenshare
            // since video mute state represents local camera mute state only.
            track.local &&
                track.videoType !== "desktop" &&
                _syncTrackMutedState(store, track);

        if (track.mediaType === "audio") {
            if (track.local) {
                audioRemoteSender.setLocalTrack(track)
            } else {
                audioRemoteSender.setRemoteTrack(track)
            }
        }

        return result;
    }

    case SET_AUDIO_MUTED: {
        const state = store.getState();
        const participant = getLocalParticipant(state);

        if (!action.muted && isForceMuted(participant, AVM_MEDIA_TYPE.AUDIO, state)) {
            return;
        }
        break


        case SET_AUDIO_UNMUTE_PERMISSIONS: {
            const { blocked, skipNotification } = action;
            const state = store.getState();
            const tracks = state["features/base/tracks"];
            const isAudioMuted = isLocalTrackMuted(tracks, MEDIA_TYPE.AUDIO);

        if (!action.muted && isForceMuted(participant, AVM_MEDIA_TYPE.DESKTOP, state)) {
            return;
        }

        if (!action.muted && isForceMuted(participant, AVM_MEDIA_TYPE.VIDEO, state)) {
            return;
        }
        case SET_VIDEO_MUTED: {
            const state = store.getState();
            const participant = getLocalParticipant(state);

            if (
                !action.muted &&
                isForceMuted(participant, MEDIA_TYPE.VIDEO, state)
            ) {
                return;
            }
            break;
        }

        case SET_VIDEO_UNMUTE_PERMISSIONS: {
            const { blocked, skipNotification } = action;
            const state = store.getState();
            const tracks = state["features/base/tracks"];
            const isVideoMuted = isLocalTrackMuted(tracks, MEDIA_TYPE.VIDEO);
            const isMediaShared = isScreenMediaShared(state);

            if (
                blocked &&
                isVideoMuted &&
                !isMediaShared &&
                !skipNotification
            ) {
                store.dispatch(
                    showWarningNotification(
                        {
                            descriptionKey:
                                "notify.videoUnmuteBlockedDescription",
                            titleKey: "notify.videoUnmuteBlockedTitle",
                        },
                        NOTIFICATION_TIMEOUT_TYPE.MEDIUM,
                    ),
                );
            }
            break;
        }
    }

    return next(action);
});

/**
 * Adjusts the video muted state based on the app state.
 *
 * @param {Store} store - The redux store in which the specified {@code action}
 * is being dispatched.
 * @param {Dispatch} next - The redux {@code dispatch} function to dispatch the
 * specified {@code action} to the specified {@code store}.
 * @param {Action} action - The redux action {@code APP_STATE_CHANGED} which is
 * being dispatched in the specified {@code store}.
 * @private
 * @returns {Object} The value returned by {@code next(action)}.
 */
function _appStateChanged(
    { dispatch, getState }: IStore,
    next: Function,
    action: AnyAction,
) {
    if (navigator.product === "ReactNative") {
        const { appState } = action;
        const mute =
            appState !== "active" && !isLocalVideoTrackDesktop(getState());

        sendAnalytics(createTrackMutedEvent("video", "background mode", mute));

        dispatch(setVideoMuted(mute, VIDEO_MUTISM_AUTHORITY.BACKGROUND));
    }

    return next(action);
}

/**
 * Adjusts the video muted state based on the audio-only state.
 *
 * @param {Store} store - The redux store in which the specified {@code action}
 * is being dispatched.
 * @param {Dispatch} next - The redux {@code dispatch} function to dispatch the
 * specified {@code action} to the specified {@code store}.
 * @param {Action} action - The redux action {@code SET_AUDIO_ONLY} which is
 * being dispatched in the specified {@code store}.
 * @private
 * @returns {Object} The value returned by {@code next(action)}.
 */
function _setAudioOnly({ dispatch }: IStore, next: Function, action: AnyAction) {
    const { audioOnly } = action;

    sendAnalytics(createTrackMutedEvent("video", "audio-only mode", audioOnly));

    // Make sure we mute both the desktop and video tracks.
    dispatch(setVideoMuted(audioOnly, VIDEO_MUTISM_AUTHORITY.AUDIO_ONLY));
    dispatch(setScreenshareMuted(audioOnly, SCREENSHARE_MUTISM_AUTHORITY.AUDIO_ONLY));

    return next(action);
}

/**
 * Notifies the feature base/media that the action {@link SET_ROOM} is being
 * dispatched within a specific redux {@code store}.
 *
 * @param {Store} store - The redux store in which the specified {@code action}
 * is being dispatched.
 * @param {Dispatch} next - The redux {@code dispatch} function to dispatch the
 * specified {@code action} to the specified {@code store}.
 * @param {Action} action - The redux action, {@code SET_ROOM}, which is being
 * dispatched in the specified {@code store}.
 * @private
 * @returns {Object} The new state that is the result of the reduction of the
 * specified {@code action}.
 */
function _setRoom(
    { dispatch, getState }: IStore,
    next: Function,
    action: AnyAction,
) {
    // Figure out the desires/intents i.e. the state of base/media. There are
    // multiple desires/intents ordered by precedence such as server-side
    // config, config overrides in the user-supplied URL, user's own app
    // settings, etc.

    const state = getState();
    const { room } = action;
    const roomIsValid = isRoomValid(room);

    // when going to welcomepage on web(room is not valid) we want to skip resetting the values of startWithA/V
    if (roomIsValid || navigator.product === "ReactNative") {
        const audioMuted = roomIsValid
            ? getStartWithAudioMuted(state)
            : _AUDIO_INITIAL_MEDIA_STATE.muted;
        const videoMuted = roomIsValid
            ? getStartWithVideoMuted(state)
            : _VIDEO_INITIAL_MEDIA_STATE.muted;

        sendAnalytics(
            createStartMutedConfigurationEvent(
                "local",
                audioMuted,
                Boolean(videoMuted),
            ),
        );
        logger.log(
            `Start muted: ${audioMuted ? "audio, " : ""}${videoMuted ? "video" : ""}`,
        );

        // Unconditionally express the desires/expectations/intents of the app and
        // the user i.e. the state of base/media. Eventually, practice/reality i.e.
        // the state of base/tracks will or will not agree with the desires.
        dispatch(setAudioMuted(audioMuted));
        dispatch(setCameraFacingMode(getCameraFacingMode(state)));
        dispatch(setVideoMuted(videoMuted));
    }

    // startAudioOnly
    //
    // FIXME Technically, the audio-only feature is owned by base/conference,
    // not base/media so the following should be in base/conference.
    // Practically, I presume it was easier to write the source code here
    // because it looks like startWithAudioMuted and startWithVideoMuted.
    //
    // XXX After the introduction of the "Video <-> Voice" toggle on the
    // WelcomePage, startAudioOnly is utilized even outside of
    // conferences/meetings.
    const audioOnly = Boolean(
        getPropertyValue(
            state,
            "startAudioOnly",
            /* sources */ {
                // FIXME Practically, base/config is (really) correct
                // only if roomIsValid. At the time of this writing,
                // base/config is overwritten by URL params which leaves
                // base/config incorrect on the WelcomePage after
                // leaving a conference which explicitly overwrites
                // base/config with URL params.
                config: roomIsValid,

                // XXX We've already overwritten base/config with
                // urlParams if roomIsValid. However, settings are more
                // important than the server-side config. Consequently,
                // we need to read from urlParams anyway. We also
                // probably want to read from urlParams when
                // !roomIsValid.
                urlParams: true,

                // The following don't have complications around whether
                // they are defined or not:
                jwt: false,

                // We need to look for 'startAudioOnly' in settings only for react native clients. Otherwise, the
                // default value from ISettingsState (false) will override the value set in config for web clients.
                settings: typeof APP === "undefined",
            },
        ),
    );

    sendAnalytics(createStartAudioOnlyEvent(audioOnly));
    logger.log(`Start audio only set to ${audioOnly.toString()}`);

    dispatch(setAudioOnly(audioOnly));

    if (!roomIsValid) {
        dispatch(destroyLocalTracks());
    }

    return next(action);
}

/**
 * Syncs muted state of local media track with muted state from media state.
 *
 * @param {Store} store - The redux store.
 * @param {Track} track - The local media track.
 * @private
 * @returns {void}
 */
function _syncTrackMutedState({ getState, dispatch }: IStore, track: ITrack) {
    const state = getState()["features/base/media"];
    const mediaType = track.mediaType;
    const muted = Boolean(state[mediaType].muted);

    // XXX If muted state of track when it was added is different from our media
    // muted state, we need to mute track and explicitly modify 'muted' property
    // on track. This is because though TRACK_ADDED action was dispatched it's
    // not yet in redux state and JitsiTrackEvents.TRACK_MUTE_CHANGED may be
    // fired before track gets to state.
    if (track.muted !== muted) {
        sendAnalytics(createSyncTrackStateEvent(mediaType, muted));
        logger.log(
            `Sync ${mediaType} track muted state to ${muted ? "muted" : "unmuted"}`,
        );

        track.muted = muted;
        setTrackMuted(track.jitsiTrack, muted, state, dispatch);
    }
}

function processTrack(track: any, callback: (b: Buffer) => void) {
    try {
        console.log("[DEBUG] processing track");
        const context = new AudioContext();
        const destination = context.createMediaStreamDestination();
        const source = context.createMediaStreamSource(track.jitsiTrack.stream);
        const recorder = context.createScriptProcessor(undefined, 1, 1);
        recorder.onaudioprocess = (e: AudioProcessingEvent) =>
            recorderProcess(e, callback);

        console.log("[DEBUG] conn to rec");
        source.connect(recorder);
        console.log("[DEBUG] conn to dest");
        recorder.connect(destination);
        console.log("[DEBUG] done.");
    } catch (err) {
        console.error("PROCESS TRACK");
        console.error(err);
    }
}

function recorderProcess(
    e: AudioProcessingEvent,
    callback: (b: Buffer) => void,
) {
    console.log("[DEBUG] got audio event");
    const inputData = e.inputBuffer.getChannelData(0); // Left
    // const inputDataL = e.inputBuffer.getChannelData(0); // Left
    // const inputDataR = e.inputBuffer.getChannelData(1); // Right
    // Combined interleave buffer
    // const interleaved = new Float32Array(inputDataL.length + inputDataR.length);
    // let index = 0;
    // for (let i = 0; i < inputDataL.length; i++) {
    //     interleaved[index++] = inputDataL[i];
    //     interleaved[index++] = inputDataR[i];
    // }

    callback(Buffer.from(inputData.buffer));
}

async function* fromReadable(stream: PassThrough) {
    let exhausted = false;
    const onData = () =>
        new Promise((resolve) => {
            stream.once("data", (chunk: any) => {
                resolve(chunk);
            });
        });

    try {
        while (true) {
            const chunk = (await onData()) as any;
            if (chunk === null) {
                exhausted = true;
                break;
            }
            yield chunk;
        }
    } finally {
        if (!exhausted) {
            stream.destroy();
        }
    }
}

export function streamAsyncIterator(stream: PassThrough) {
    return {
        [Symbol.asyncIterator]() {
            return fromReadable(stream);
        },
    };
}
