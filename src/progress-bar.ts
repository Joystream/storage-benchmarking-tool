import * as _ from 'lodash';
import * as cliProgress from 'cli-progress';
import chalk from 'chalk';

/**
 * Create a new progress bar with a custom token "speed".
 */
export function newProgressBar (kind: `range-download` | `full-download` | `upload`) {
  let prefix: string
  if (kind === `full-download`) prefix = `Full download`
  else if (kind === `range-download`) prefix = `Range download`
  else if (kind === `upload`) prefix = `Upload`
  
  const range = kind === `range-download` ? ` | Range #{range}/{rangesCount}` : ``
  const eta = kind !== `range-download` ? ` | ETA: {eta}s` : ``
  const speed = kind === 'full-download' ? ` | Speed: {speed} MB/sec` : ``

  return new cliProgress.Bar({
    format: `${prefix} ${chalk.green('[{bar}]')} {percentage}%${range}${eta} | ${chalk.bold('{value}')}/{total} bytes${speed}`,
    barCompleteChar: '◼'
  }, cliProgress.Presets.rect);
}
