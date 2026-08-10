import { useMemo } from 'react';
import { computeWorstMoments } from '../../levels/report';
import { computeCompositeScore, computeStars, type StarRating } from '../../levels/scoring';
import type { StarThresholds } from '../../levels/types';
import { TICK_RATE } from '../../sim/config';
import type { SimResult } from '../../sim/simulate';
import { usePlaybackStore } from '../../store/playbackStore';

function formatTick(tick: number): string {
  const totalSeconds = Math.floor(tick / TICK_RATE);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function starGlyphs(stars: StarRating): string {
  return '★★★☆☆☆'.slice(3 - stars, 6 - stars);
}

export interface ShiftReportProps {
  result: SimResult;
  starThresholds: StarThresholds;
}

export function ShiftReport({ result, starThresholds }: ShiftReportProps): JSX.Element {
  const composite = useMemo(() => computeCompositeScore(result.score), [result]);
  const stars = computeStars(composite, starThresholds);
  const worstMoments = useMemo(() => computeWorstMoments(result), [result]);
  const requestSeek = usePlaybackStore((s) => s.requestSeek);

  return (
    <section aria-label="End-of-shift report">
      <h2>End-of-shift report</h2>
      <p>
        <strong aria-label={`${stars} out of 3 stars`}>{starGlyphs(stars)}</strong> — composite score {composite} / 1000
      </p>
      <ul>
        <li>
          Delivered: {result.score.delivered} / {result.score.spawned}
        </li>
        <li>Gave up: {result.score.gaveUp}</li>
        <li>Average wait: {(result.score.averageWaitTicks / TICK_RATE).toFixed(1)}s</li>
        <li>Worst wait: {(result.score.worstWaitTicks / TICK_RATE).toFixed(1)}s</li>
      </ul>

      <h3>Worst moments</h3>
      {worstMoments.length === 0 ? (
        <p>No notable incidents. Clean shift.</p>
      ) : (
        <ol>
          {worstMoments.map((moment, index) => (
            <li key={index}>
              <button type="button" onClick={() => requestSeek(moment.tick)}>
                Floor {moment.floor}, {formatTick(moment.tick)} — {moment.description}
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
