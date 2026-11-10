/**
 * 图样库：常见生命游戏图样，点选后在画布上盖章。
 *
 * 简单图样直接用字符画（一眼能看出形状），
 * 高斯帕滑翔机枪这种 36 格的用 RLE —— 手写坐标容易错，标准 RLE 更好核对。
 */

/** 字符画转坐标：O 或 # 为活细胞 */
function fromRows(rows) {
  const cells = [];
  rows.forEach((line, y) => {
    [...line].forEach((ch, x) => {
      if (ch === 'O' || ch === '#') cells.push([x, y]);
    });
  });
  return cells;
}

/**
 * 解析 RLE。支持 b（死）、o（活）、$（换行）、!（结束）与重复计数。
 * @param {string} source
 * @returns {[number, number][]}
 */
export function parseRLE(source) {
  const cells = [];
  let x = 0;
  let y = 0;
  let run = 0;

  for (const ch of source.replace(/\s+/g, '')) {
    if (ch >= '0' && ch <= '9') {
      run = run * 10 + Number(ch);
      continue;
    }
    const n = run || 1;
    run = 0;
    if (ch === 'b') {
      x += n;
    } else if (ch === 'o') {
      for (let i = 0; i < n; i++) cells.push([x + i, y]);
      x += n;
    } else if (ch === '$') {
      y += n;
      x = 0;
    } else if (ch === '!') {
      break;
    } else {
      throw new Error(`RLE 中出现无法识别的字符：${ch}`);
    }
  }

  return cells;
}

/** 高斯帕滑翔机枪：周期 30，每周期放出一只滑翔机 */
const GOSPER_GUN =
  '24bo$22bobo$12b2o6b2o12b2o$11bo3bo4b2o12b2o$2o8bo5bo3b2o$2o8bo3bob2o4bobo$10bo5bo7bo$11bo3bo$12b2o!';

/** @type {{id: string, label: string, cells: [number, number][]}[]} */
export const PATTERNS = [
  { id: 'glider', label: '滑翔机', cells: fromRows(['.O.', '..O', 'OOO']) },
  { id: 'lwss', label: '轻型飞船', cells: fromRows(['.O..O', 'O....', 'O...O', 'OOOO.']) },
  { id: 'blinker', label: '闪烁器', cells: fromRows(['OOO']) },
  { id: 'block', label: '方块', cells: fromRows(['OO', 'OO']) },
  { id: 'toad', label: '蟾蜍', cells: fromRows(['.OOO', 'OOO.']) },
  { id: 'beacon', label: '信标', cells: fromRows(['OO..', 'OO..', '..OO', '..OO']) },
  {
    id: 'pulsar',
    label: '脉冲星',
    cells: fromRows([
      '..OOO...OOO..',
      '.............',
      'O....O.O....O',
      'O....O.O....O',
      'O....O.O....O',
      '..OOO...OOO..',
      '.............',
      '..OOO...OOO..',
      'O....O.O....O',
      'O....O.O....O',
      'O....O.O....O',
      '.............',
      '..OOO...OOO..',
    ]),
  },
  {
    id: 'pentadecathlon',
    label: '十五项全能',
    cells: fromRows(['..O....O..', 'OO.OOOO.OO', '..O....O..']),
  },
  { id: 'acorn', label: '橡果', cells: fromRows(['.O.....', '...O...', 'OO..OOO']) },
  { id: 'rpentomino', label: 'R 五连', cells: fromRows(['.OO', 'OO.', '.O.']) },
  { id: 'diehard', label: '顽固分子', cells: fromRows(['......O.', 'OO......', '.O...OOO']) },
  { id: 'gospergun', label: '滑翔机枪', cells: parseRLE(GOSPER_GUN) },
];

/**
 * 旋转图样 90 度，并把坐标平移回左上角
 * @param {[number, number][]} cells
 * @returns {[number, number][]}
 */
export function rotatePattern(cells) {
  const rotated = cells.map(([x, y]) => [-y, x]);
  const minX = Math.min(...rotated.map((c) => c[0]));
  const minY = Math.min(...rotated.map((c) => c[1]));
  return rotated.map(([x, y]) => [x - minX, y - minY]);
}
