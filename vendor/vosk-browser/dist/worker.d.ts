import * as VoskWasm from "./vosk-wasm";
export interface Recognizer {
    id: string;
    buffAddr?: number;
    buffSize?: number;
    recognizer: VoskWasm.Recognizer;
    sampleRate: number;
    words?: boolean;
    grammar?: string;
}
export declare class RecognizerWorker {
    private Vosk;
    private model;
    private recognizers;
    private logger;
    constructor();
    private handleMessage;
    private load;
    private allocateBuffer;
    private freeBuffer;
    private createRecognizer;
    private setConfiguration;
    private processAudioChunk;
    private retrieveFinalResult;
    private removeRecognizer;
    private terminate;
}
