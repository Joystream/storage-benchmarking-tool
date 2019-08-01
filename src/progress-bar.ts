import * as _ from 'lodash';
import * as cliProgress from 'cli-progress';
import chalk from 'chalk';

/**
 * Create a new progress bar with a custom token "speed".
 */
export function newProgressBar (kind: 'download' | 'upload') {
  const prefix = kind === 'download' ? `Downloading` : `Uploading`
  const speed = kind === 'download' ? ` | Speed: {speed} MB/sec` : ``

  return new cliProgress.Bar({
    format: `${prefix} ${chalk.green('[{bar}]')} {percentage}% | ETA: {eta}s | ${chalk.bold('{value}')}/{total} bytes${speed}`,
    barCompleteChar: '◼'
  }, cliProgress.Presets.rect);
}
