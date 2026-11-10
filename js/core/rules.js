/**
 * 规则层：把「B3/S23」这类规则串解析成查表数组。
 *
 * 生命游戏的全部规则就是两个集合：
 *   - 出生集合 B：死细胞在存活邻居数 n 时诞生
 *   - 存活集合 S：活细胞在存活邻居数 n 时活下去，否则死亡
 * 邻居数最多 8（摩尔邻域），所以查表长度固定为 9。
 *
 * 写成查表而不是 Set，是因为每步要对每个格子查一次，数组下标比 Set.has 快一个量级。
 */

const MAX_DEGREE = 9;

/**
 * 预置规则。全部是标准 B/S 记号，可以随意扩展。
 * 参数 notes 只是给界面看的说明，不参与计算。
 */
export const RULE_PRESETS = [
  { name: '康威生命游戏', rule: 'B3/S23', notes: '经典，涌现出滑翔机、枪、计算结构' },
  { name: 'HighLife', rule: 'B36/S23', notes: '多了 B6，存在自我复制体' },
  { name: 'Day & Night', rule: 'B3678/S34678', notes: '结构与死区对称的对称规则' },
  { name: 'Seeds', rule: 'B2/S', notes: '没有细胞能存活，全靠爆炸式诞生' },
  { name: 'Maze', rule: 'B3/S12345', notes: '长出迷宫状通道' },
  { name: 'Replicator', rule: 'B1357/S1357', notes: '任何图样都在自我复制' },
  { name: '2x2', rule: 'B36/S125', notes: '以 2x2 块为基本单元的增殖' },
  { name: 'Diamoeba', rule: 'B35678/S5678', notes: '不规则斑块，边缘不断变形' },
];

/**
 * 解析规则串，容错处理常见写法：
 *   B3/S23、b3/s23、B3/S23（带空格）、3/23（省略 B/S 前缀）
 * @param {string} input
 * @returns {{birth: Uint8Array, survive: Uint8Array, text: string}}
 */
export function parseRule(input) {
  const raw = String(input || '').replace(/\s+/g, '').toUpperCase();
  const match = /^B?([0-8]*)\/S?([0-8]*)$/.exec(raw);
  if (!match) {
    throw new Error(`规则格式不对：${input}，应形如 B3/S23`);
  }

  const birth = new Uint8Array(MAX_DEGREE);
  const survive = new Uint8Array(MAX_DEGREE);
  for (const ch of match[1]) birth[Number(ch)] = 1;
  for (const ch of match[2]) survive[Number(ch)] = 1;

  return { birth, survive, text: formatRule({ birth, survive }) };
}

/**
 * 反向格式化，保证界面里显示的和内部生效的是同一份规则
 * @param {{birth: Uint8Array, survive: Uint8Array}} rule
 */
export function formatRule(rule) {
  const digits = (table) => {
    let out = '';
    for (let i = 0; i < table.length; i++) if (table[i]) out += i;
    return out;
  };
  return `B${digits(rule.birth)}/S${digits(rule.survive)}`;
}
