import { PassThrough, Stream } from "stream-browserify";
import { EncodePcmStream } from "./EncodePCM";
import Mic from "./MicrophoneStream";
import { ITrack } from "../tracks/types";

const DEBUG = false


/**
 * Sends audio chunks to the parent window when both the local and remote track
 * are sent
 */
export class AudioRemoteSender {
    private localTrack: ITrack | null = null;
    private remoteTrack: ITrack | null = null;
    private stream: MediaStream | undefined;
    private audioPayloadStream: PassThrough | null = null;
    private isReady: boolean = false;
    private isClientReady: boolean = false

    constructor() {
        window.addEventListener('message', (ev) => {
            if (ev.data?.type !== 'audio-receiver-ready') { return }
            debugLog('audio-receiver-ready', this.isReady)
            this.isClientReady = true
            if (this.isReady) {
                this.emitAudioReady()
            }
        })
    }

    setLocalTrack(track: ITrack) {
        debugLog('local track added')
        this.localTrack = track;
        this.tryStartSharing();
    }

    setRemoteTrack(track: ITrack) {
        debugLog('remote track added')
        this.remoteTrack = track;
        this.tryStartSharing();
    }

    /**
     * If both the remote and local track are set:
     * - Creates a stream of audio that's PCM encoded
     * - With localTrack on channel 0 and remote track on channel 1
     * - Emits all audio chunks produced to the parent window
     */
    tryStartSharing() {
        if (this.audioPayloadStream) {
            this.audioPayloadStream.off("data", this.emitAudioChunk);
        }
        debugLog("sending...");
        this.stream = this.getStream();
        if (!this.stream) {
            debugLog("failed to startSending, missing track")
            return;
        }
        const micStream = new Mic();
        micStream.setStream(this.stream);

        debugLog("piping...")
        const audioPayloadStream = (micStream as unknown as Stream)
            .pipe(new EncodePcmStream(true))
            .pipe(new PassThrough({ highWaterMark: 1 * 1024 }));

        this.audioPayloadStream = audioPayloadStream;

        debugLog("on")
        audioPayloadStream.on("data", this.emitAudioChunk);
        audioPayloadStream.on("close", () => {
            window.parent?.postMessage(
                {
                    type: "audio-close",
                },
                "*",
            );
            debugLog("close")
        });
        debugLog("all setup")

        this.isReady = true
        this.emitAudioReady()
    }

    /**
     * When both, local and remote tracks are available this returns a stream
     * of audio with localTrack on channel 0 and remoteTrack on channel 1
     */
    getStream() {
        if (!this.localTrack || !this.remoteTrack) {
            debugLog(!!this.localTrack, !!this.remoteTrack)
            return;
        }

        debugLog("create context")
        const context = new AudioContext();
        const destination = context.createMediaStreamDestination();

        debugLog("create localSource")
        const localSource = context.createMediaStreamSource(
            this.localTrack.jitsiTrack.stream,
        );

        debugLog("create remoteSource")
        const remoteSource = context.createMediaStreamSource(
            this.remoteTrack.jitsiTrack.stream,
        );

        debugLog("create merger")
        const merger = context.createChannelMerger(2);
        localSource.connect(merger, 0, 0);
        remoteSource.connect(merger, 0, 1);

        debugLog("connect to dest")
        merger.connect(destination);

        return destination.stream;
    }

    private emitAudioChunk = (data: Buffer) => {
        if (!this.isClientReady) {
            debugLog('skip audio-chunk')
            return
        }
        debugLog('emitting audio-chunk')
        const event = { type: "audio-chunk", buffer: data };
        window.parent?.postMessage(event, "*");
    }

    emitAudioReady() {
        console.log('emitting audio-ready')
        window.parent?.postMessage({ type: 'audio-ready' }, "*")
    }

    emitAudioClose() {
        window.parent?.postMessage({ type: 'audio-close' }, "*")
    }
}

function debugLog(...args: any[]) {
    if (!DEBUG) { return }
    console.log('[DEBUG]', ...args)
}

