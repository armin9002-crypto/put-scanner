# Underlying Technical Assessment V1

## Contract and scope

`UnderlyingTechnicalAssessment` is Put Scanner's single deterministic, ticker-specific technical assessment. Contract version `1` is defined in `src/lib/underlyingTechnical.ts`; that module owns every classification threshold. ETF Pulse calculates the assessment once from its existing bounded two-year daily-close dataset. Recommendations consumes that same assessment object. No AI, LLM, model, prediction, training, fundamental analysis, valuation, holdings analysis, or benchmark-relative-strength claim is made.

The assessment adds zero Yahoo calls, Vercel calls, per-ticker endpoints, polling, background work, OHLC acquisition, volume acquisition, or benchmark-history acquisition. Changing a filter, sort, visual, evidence view, or Recommendations consumer remains local.

## States

The exhaustive state taxonomy is:

- `STRONG_TREND`
- `CONSTRUCTIVE_PULLBACK`
- `OVERSOLD_INTACT`
- `RECOVERY_RECLAIM`
- `EXTENDED`
- `TRANSITION_DETERIORATING`
- `BROKEN_TREND`
- `RANGE_NEUTRAL`
- `INSUFFICIENT_DATA`

`OVERSOLD_INTACT` means short-term momentum is oversold while the 200-day structure remains positive. It is not automatically bullish. `BROKEN_TREND` requires severe structural damage and remains distinct from a controlled pullback.

## Close-derived metrics

Every observation at date T uses only closes dated at or before T. Invalid or insufficient inputs return `null`; zero is retained where it is economically valid.

| Family | Exact V1 metric |
| --- | --- |
| Existing returns | 1, 5, 30, 63, 126, and 252 trading-observation close returns; YTD begins with the first observation in the latest observation's calendar year |
| Existing trend | SMA20, SMA50, SMA200 and latest-close distance from each |
| Existing momentum/stress | RSI14, 20-observation annualized realized volatility, 30-observation drawdown, 252-observation high/low, position, and drawdown |
| MA structure | Bullish stack means SMA20 > SMA50 > SMA200; bearish is the inverse; otherwise mixed |
| MA slopes | Percentage change in SMA20 over 5 observations, SMA50 over 10, and SMA200 over 20 |
| Persistence | Share of the latest 20 observations whose close is at or above its contemporaneous SMA50 and SMA200 |
| Momentum change | Current RSI14 minus RSI14 five observations earlier |
| Recovery | Latest close divided by the lowest close in the latest 20 observations, minus one |
| Volatility context | 60-observation annualized realized volatility and RV20 / RV60; volatility uses population variance of daily close returns and `sqrt(252)` annualization |

## Evidence quality

The twelve core fields are latest close, distances 20/50/200, 5D/30D/3M returns, RSI14, RV20, recent drawdown, 52-week position, and 52-week drawdown. The nine orthogonal fields are RSI change, RV60, RV20/RV60, three MA slopes, two persistence shares, and recovery from the 20-observation low.

- `HIGH`: all 12 core fields and at least 7 orthogonal fields are finite.
- `MODERATE`: latest close, distances 20/50/200, 30D return, RSI14, RV20, and recent drawdown are finite.
- `LOW`: the moderate minimum is not met; state is `INSUFFICIENT_DATA`.

## Exact signal thresholds

Structure is `BROKEN` when price is below both SMA50 and SMA200. It is `STRONG` when the MA stack is bullish, all three distances are positive, SMA50/SMA200 slopes are non-negative when available, persistence above SMA50 is at least 75%, and persistence above SMA200 is at least 80%. It is `POSITIVE` when distance200 is positive and distance50 is at least -3%. Negative short/intermediate structure is `DETERIORATING`; otherwise it is mixed.

Momentum is `OVERSOLD` below RSI 35 with non-positive 5D return. It is `DETERIORATING` when both 5D and 30D returns are negative or RSI14 has fallen at least 5 points in five observations. It is `STRONG` when 5D, 30D, and 3M returns are positive, RSI is at least 55, and available RSI change is non-negative. Positive 30D and 3M returns are otherwise `POSITIVE`.

Reset/extension is:

- `EXTENDED` when RSI >72 with distance20 at least 4%; 52-week position is at least 97% with distance20 at least 3%; distance20 is at least 12%; or distance50 is at least 18%.
- `OVERSOLD` when distance200 is positive and RSI is below 35.
- `RECOVERING` when recovery from the 20-observation low is at least 5%, RSI has improved at least 5 points in five observations, 5D return is positive, distance20 is at least -1%, and distance50 is at least -3%.
- `CONSTRUCTIVE_RESET` when distance200 is positive, recent drawdown is between -15% and -3% inclusive, distance50 is at least -3%, and distance20 is no more than 3%.
- `NEUTRAL` otherwise.

Volatility stress is `STRESSED` when RV20 is at least 120% and recent drawdown is at most -12%; otherwise it is `ACCELERATING` when RV20/RV60 is at least 1.25, `ELEVATED` when RV20 is at least 95%, and `NORMAL` otherwise.

## State precedence

Classification is deterministic and ordered: insufficient evidence; severe broken trend; extended; oversold intact; recovery/reclaim; constructive pullback; strong trend; transition/deteriorating; range/neutral. Severe broken trend requires price below SMA50 and SMA200 plus either distance200 at most -8% or recent drawdown at most -20%. A non-severe broken/intermediate structure remains `TRANSITION_DETERIORATING`; this preserves the existing narrow hard-fail philosophy.

Reason codes are emitted in stable evidence order and identify evidence completeness, MA stack, long-term integrity, persistence, reset/recovery, deterioration, volatility acceleration/stress, extension, and range behavior.

## Product integration and cache

ETF Pulse renders and filters the shared state. Its legacy `trend` field remains only as a compatibility projection for Market Read: Strong Trend/Extended → Strong Uptrend; Constructive Pullback/Recovery → Uptrend; Oversold Intact/Deteriorating → Weakening; Broken Trend → Downtrend; Range/Insufficient → Neutral.

Market Regime remains a separate cross-universe analysis of SPY, QQQ, breadth, volatility proxies, and aggregate return/volatility context. It is not embedded into `UnderlyingTechnicalAssessment`. Recommendations adds Regime Fit only after consuming the shared ticker assessment.

Calculated row cache key `etf_pulse_rows:v3` stores assessment version 1. A compatible `v2` row cache is upgraded locally with unavailable new orthogonal fields preserved as `null`; it does not force a provider request. The next normal explicit refresh rebuilds the full assessment from cached/acquired histories.

Deliberately excluded signals are ATR, ADX, volume confirmation, OHLC/candlestick logic, MACD, Bollinger bands, fundamentals, valuation, holdings scores, ML/AI, and benchmark relative strength.
