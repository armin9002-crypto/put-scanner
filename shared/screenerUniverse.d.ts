export declare const SCREENER_TICKERS: readonly string[];
export declare const SCREENER_PREFETCH_TICKERS: readonly string[];
export declare const SCREENER_CHUNK_SIZE: number;
export declare const SCREENER_SERVER_CONCURRENCY: number;
export declare const SCREENER_BROWSER_CONCURRENCY: number;
export interface ScreenerChunk { id: number; tickers: readonly string[] }
export declare function getScreenerChunks(): readonly ScreenerChunk[];
export declare const SCREENER_CHUNKS: readonly ScreenerChunk[];
