import { Stream, PassThrough, Transform } from "stream-browserify";
import Mic from "./MicrophoneStream";

export class EncodePcmStream extends Transform {
    private stereo?: boolean;

    constructor(stereo?: boolean) {
        super();
        this.stereo = stereo;
    }

    _transform = (chunk: any, encoding: string, callback: any) => {
        const buffer = this.stereo ? encodePcmStereo(chunk) : encodePcm(chunk);
        this.push(buffer);
        callback();
    };
}

function encodePcmStereo(chunk: any) {
    const input = Mic.toRaw(chunk);

    const numberOfChannels = 2; // Assuming stereo (2 channels)
    const channelLength = input.length / numberOfChannels;

    let offset = 0;
    const buffer = new ArrayBuffer(input.length * 2); // Need twice as much space if keeping stereo
    const view = new DataView(buffer);

    for (let i = 0; i < channelLength; i++) {
        // Process left channel sample
        let s = Math.max(-1, Math.min(1, input[i * numberOfChannels]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        offset += 2;

        // Process right channel sample
        s = Math.max(-1, Math.min(1, input[i * numberOfChannels + 1]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        offset += 2;
    }

    return Buffer.from(buffer);
}

function encodePcm(chunk: any) {
    const input = Mic.toRaw(chunk);

    let offset = 0;
    const buffer = new ArrayBuffer(input.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < input.length; i++, offset += 2) {
        const s = Math.max(-1, Math.min(1, input[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }

    return Buffer.from(buffer);
}
