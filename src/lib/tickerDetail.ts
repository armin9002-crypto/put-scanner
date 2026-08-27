import { getSymbolMetadata, normalizeSymbolTicker, type AssetType, type SymbolMetadata } from '../../shared/symbolRegistry.js';

export type DetailAssetType = AssetType | 'unknown';

export interface ProviderInstrumentIdentity {
  name?: string | null;
  quoteType?: string | null;
}

export interface TickerDetailInstrument {
  ticker: string;
  name: string;
  assetType: DetailAssetType;
  registryMetadata: SymbolMetadata | null;
  leveraged: boolean;
  leverageMultiple: number | null;
  showHoldings: boolean;
  showLeverage: boolean;
  showLeveragedProductWarning: boolean;
  showEtfCopy: boolean;
  metadataSource: 'registry' | 'provider' | 'generic';
}

export interface AnalyzeTickerNormalization {
  ticker: string | null;
  error: string | null;
}

const SUPPORTED_TICKER_PATTERN = /^[A-Z0-9.^-]{1,12}$/;

export function normalizeAnalyzeTicker(value: unknown): AnalyzeTickerNormalization {
  if (typeof value !== 'string') return { ticker: null, error: 'Enter a ticker symbol.' };
  const ticker = normalizeSymbolTicker(value);
  if (!ticker) return { ticker: null, error: 'Enter a ticker symbol.' };
  if (!SUPPORTED_TICKER_PATTERN.test(ticker)) {
    return { ticker: null, error: 'Use a valid ticker with letters, numbers, dots, carets, or hyphens.' };
  }
  return { ticker, error: null };
}

function inferProviderAssetType(quoteType: string | null | undefined): DetailAssetType {
  const normalized = quoteType?.trim().toUpperCase();
  if (normalized === 'ETF') return 'etf';
  if (normalized === 'EQUITY' || normalized === 'STOCK') return 'stock';
  if (normalized === 'INDEX') return 'index';
  return 'unknown';
}

export function resolveTickerDetailInstrument(
  tickerInput: unknown,
  provider: ProviderInstrumentIdentity = {},
): TickerDetailInstrument | null {
  const normalized = normalizeAnalyzeTicker(tickerInput);
  if (!normalized.ticker) return null;
  const metadata = getSymbolMetadata(normalized.ticker);
  const inferredAssetType = inferProviderAssetType(provider.quoteType);
  const assetType: DetailAssetType = metadata?.assetType ?? inferredAssetType;
  const leveraged = assetType === 'etf' && metadata?.leveraged === true;
  const providerName = typeof provider.name === 'string' ? provider.name.trim() : '';
  const name = metadata?.name ?? (providerName || normalized.ticker);

  return {
    ticker: normalized.ticker,
    name,
    assetType,
    registryMetadata: metadata,
    leveraged,
    leverageMultiple: leveraged ? metadata?.leverageMultiple ?? null : null,
    showHoldings: assetType === 'etf',
    showLeverage: leveraged,
    showLeveragedProductWarning: leveraged,
    showEtfCopy: assetType === 'etf',
    metadataSource: metadata ? 'registry' : providerName || inferredAssetType !== 'unknown' ? 'provider' : 'generic',
  };
}
