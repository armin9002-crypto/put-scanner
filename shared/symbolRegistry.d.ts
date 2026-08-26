export type AssetType = 'etf' | 'stock' | 'index';
export type SymbolUniverse = 'scanner' | 'screener' | 'pulse' | 'context';
export type SymbolEtfCategory = 'Broad Index' | 'Sector' | 'Commodity' | 'Country';

export interface SymbolMetadata {
  readonly ticker: string;
  readonly aliases: readonly string[];
  readonly name: string;
  readonly assetType: AssetType;
  readonly etfCategory?: SymbolEtfCategory;
  readonly exposure?: string;
  readonly leveraged: boolean;
  readonly leverageMultiple: number | null;
  readonly universeMembership: readonly SymbolUniverse[];
}

export declare const SYMBOL_REGISTRY: readonly SymbolMetadata[];
export declare function normalizeSymbolTicker(ticker: unknown): string;
export declare function getSymbolMetadata(ticker: unknown): SymbolMetadata | null;
export declare function getSymbolsForUniverse(universe: SymbolUniverse): readonly SymbolMetadata[];
export declare const SCANNER_SYMBOLS: readonly SymbolMetadata[];
export declare const SCREENER_SYMBOLS: readonly SymbolMetadata[];
export declare const ETF_PULSE_SYMBOLS: readonly SymbolMetadata[];
export declare const CONTEXT_SYMBOLS: readonly SymbolMetadata[];
