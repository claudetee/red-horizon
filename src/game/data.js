// RED HORIZON — all balance & content tables. Single tuning surface.

export const PLAYER = 0, ENEMY = 1;

export const TEAM_COLORS = {
  [PLAYER]: { main: '#35e8d8', sel: '#3ff0e0', hp: '#35e85f', mini: '#35e8d8' },
  [ENEMY]:  { main: '#ff4444', sel: '#ff5348', hp: '#ff5348', mini: '#ff4040' },
};

// armor multiplier tables: how much of this weapon's damage each armor class takes
export const WEAPONS = {
  rifleMG:    { dmg: 8,  rof: 0.55, range: 4.2, kind: 'bullet', burst: 1,
                vs: { inf: 1.0, light: 0.42, heavy: 0.18, building: 0.22 }, sfx: 'mg' },
  buggyMG:    { dmg: 9,  rof: 0.20, range: 4.6, kind: 'bullet', burst: 1,
                vs: { inf: 1.0, light: 0.52, heavy: 0.2, building: 0.24 }, sfx: 'mg2' },
  rocket:     { dmg: 44, rof: 2.3, range: 5.8, kind: 'rocket', speed: 220, splash: 15, burst: 1,
                vs: { inf: 0.45, light: 0.95, heavy: 1.0, building: 1.15 }, sfx: 'rocket' },
  cannon:     { dmg: 55, rof: 1.8, range: 5.2, kind: 'shell', speed: 330, splash: 16, burst: 1,
                vs: { inf: 0.55, light: 0.9, heavy: 1.0, building: 0.78 }, sfx: 'cannon' },
  twinCannon: { dmg: 46, rof: 2.6, range: 5.4, kind: 'shell', speed: 330, splash: 17, burst: 2, burstGap: 0.16,
                vs: { inf: 0.6, light: 0.95, heavy: 1.0, building: 0.88 }, sfx: 'cannon2' },
  turretGun:  { dmg: 60, rof: 1.7, range: 6.2, kind: 'shell', speed: 360, splash: 13, burst: 1,
                vs: { inf: 0.5, light: 1.0, heavy: 1.0, building: 0.6 }, sfx: 'cannon' },
};

export const BUILDINGS = {
  conyard: {
    cn: '建 造 厂', en: 'CONSTRUCTION YARD', cost: 2500, hp: 1500, power: 0,
    fw: 3, fh: 3, sight: 6, sprite: 'bld_conyard', buildable: false,
    desc: '基地核心。失去所有建筑即战败。',
  },
  power: {
    cn: '发 电 厂', en: 'POWER PLANT', cost: 300, hp: 400, power: +100,
    fw: 2, fh: 2, sight: 4, sprite: 'bld_power', buildable: true, hotkey: 'Q',
    desc: '提供 100 电力。电力不足时生产减速、雷达与炮塔失效。',
  },
  refinery: {
    cn: '矿石精炼厂', en: 'ORE REFINERY', cost: 1400, hp: 900, power: -30,
    fw: 3, fh: 3, sight: 5, sprite: 'bld_refinery', buildable: true, hotkey: 'W',
    prereq: ['power'], freeUnit: 'harvester',
    desc: '接收矿石转化为资金，附赠一辆采矿车。',
  },
  barracks: {
    cn: '兵 营', en: 'BARRACKS', cost: 400, hp: 500, power: -10,
    fw: 2, fh: 2, sight: 5, sprite: 'bld_barracks', buildable: true, hotkey: 'E',
    prereq: ['power'], produces: 'inf',
    desc: '训练步兵单位。',
  },
  factory: {
    cn: '战 车 工 厂', en: 'WAR FACTORY', cost: 1600, hp: 1000, power: -30,
    fw: 3, fh: 3, sight: 5, sprite: 'bld_factory', buildable: true, hotkey: 'R',
    prereq: ['refinery'], produces: 'veh',
    desc: '生产载具单位。',
  },
  radar: {
    cn: '雷 达 站', en: 'RADAR DOME', cost: 1000, hp: 700, power: -40,
    fw: 2, fh: 2, sight: 8, sprite: 'bld_radar', buildable: true, hotkey: 'T',
    prereq: ['refinery'],
    desc: '启用小地图雷达，并解锁重型科技。',
  },
  turret: {
    cn: '防 御 炮 塔', en: 'GUN TURRET', cost: 500, hp: 450, power: -20,
    fw: 1, fh: 1, sight: 7, sprite: 'bld_turret', turretSprite: 'bld_turret_gun',
    buildable: true, hotkey: 'Y', prereq: ['barracks'], weapon: 'turretGun',
    desc: '自动炮塔，克制载具。断电时射速减半。',
  },
};

export const UNITS = {
  rifle: {
    cn: '步 枪 兵', en: 'RIFLEMAN', cost: 120, hp: 60, speed: 46, turn: 12,
    sight: 4.5, armor: 'inf', weapon: 'rifleMG', r: 5, sprite: 'unit_rifle',
    factory: 'barracks', hotkey: 'Q', kind: 'inf',
    desc: '廉价主力步兵，克制敌方步兵。',
  },
  rocket: {
    cn: '火 箭 兵', en: 'ROCKETEER', cost: 300, hp: 55, speed: 40, turn: 12,
    sight: 5, armor: 'inf', weapon: 'rocket', r: 5, sprite: 'unit_rocket',
    factory: 'barracks', hotkey: 'W', kind: 'inf',
    desc: '反装甲步兵，克制载具与建筑。',
  },
  buggy: {
    cn: '侦 察 车', en: 'SCOUT BUGGY', cost: 600, hp: 230, speed: 128, turn: 4.6,
    sight: 6.5, armor: 'light', weapon: 'buggyMG', r: 10, sprite: 'unit_buggy',
    factory: 'factory', hotkey: 'E', kind: 'veh',
    desc: '高速侦察载具，机枪克制步兵。',
  },
  harvester: {
    cn: '采 矿 车', en: 'ORE HARVESTER', cost: 1200, hp: 650, speed: 62, turn: 3.2,
    sight: 4, armor: 'heavy', weapon: null, r: 13, sprite: 'unit_harvester',
    factory: 'factory', hotkey: 'R', kind: 'veh', harvester: true,
    desc: '自动采集矿石并运回精炼厂。',
  },
  tank: {
    cn: '中 型 坦 克', en: 'MEDIUM TANK', cost: 900, hp: 430, speed: 74, turn: 2.9,
    sight: 5.5, armor: 'heavy', weapon: 'cannon', r: 11, sprite: 'unit_tank_hull',
    turretSprite: 'unit_tank_gun', turretTurn: 4.2,
    factory: 'factory', hotkey: 'T', kind: 'veh',
    desc: '主战坦克，装甲对决的中坚。',
  },
  heavy: {
    cn: '猛 犸 重 坦', en: 'MAMMOTH TANK', cost: 1750, hp: 980, speed: 50, turn: 2.0,
    sight: 6, armor: 'heavy', weapon: 'twinCannon', r: 14, sprite: 'unit_heavy_hull',
    turretSprite: 'unit_heavy_gun', turretTurn: 3.2,
    factory: 'factory', hotkey: 'Y', kind: 'veh', prereqBld: ['radar'],
    desc: '双管重型坦克，需要雷达站解锁。',
  },
};

export const ECON = {
  startCredits: 6000,
  oreCellMax: 650,
  harvestCapacity: 700,
  harvestRate: 185,      // credits/sec while mining
  unloadTime: 2.6,       // sec docked at refinery
  oreRegen: 0.9,         // credits/sec per non-empty cell
  sellRefund: 0.7,
  repairCostFactor: 0.35, // fraction of cost to repair from 0 to full
  repairRate: 40,         // hp/sec
  lowPowerBuildFactor: 0.45,
  lowPowerRofFactor: 0.55,
};

export const BUILD_TIME = cost => 1.2 + cost / 300; // seconds

export const DIFFICULTY = {
  easy:   { cn: '侦察兵', aiCredits: 5000, trickle: 0,  firstWave: 300, waveEvery: 185, waveScale: 0.7, income: 0.8 },
  normal: { cn: '老 兵',  aiCredits: 6000, trickle: 7,  firstWave: 235, waveEvery: 150, waveScale: 1.0, income: 1.0 },
  hard:   { cn: '铁 幕',  aiCredits: 9000, trickle: 18, firstWave: 155, waveEvery: 115, waveScale: 1.45, income: 1.3 },
};

// EVA voice lines (zh) — spoken via SpeechSynthesis when available + banner text
export const EVA = {
  constructionComplete: { t: '建造完毕', cls: 'good' },
  unitReady:            { t: '单位就绪', cls: 'good' },
  onHold:               { t: '生产暂停', cls: '' },
  cancelled:            { t: '生产取消', cls: '' },
  lowPower:             { t: '电力不足', cls: '' },
  insufficientFunds:    { t: '资金不足', cls: '' },
  baseUnderAttack:      { t: '基地遭到攻击', cls: '' },
  unitsUnderAttack:     { t: '部队遭遇袭击', cls: '' },
  harvesterUnderAttack: { t: '采矿车遭到攻击', cls: '' },
  unitLost:             { t: '单位损失', cls: '' },
  buildingLost:         { t: '建筑被摧毁', cls: '' },
  radarOnline:          { t: '雷达启动', cls: 'good' },
  radarOffline:         { t: '雷达离线', cls: '' },
  newOptions:           { t: '新建造选项', cls: 'good' },
  enemySighted:         { t: '发现敌军', cls: '' },
  cannotBuildThere:     { t: '无法在此建造', cls: '' },
  needMoreOre:          { t: '矿脉枯竭，寻找新矿区', cls: '' },
  victory:              { t: '任务完成', cls: 'gold' },
  defeat:               { t: '任务失败', cls: '' },
};

export const TIPS = [
  '提示：保持电力盈余，断电会拖慢一切生产。',
  '提示：采矿车是经济命脉，敌人会优先猎杀它。',
  '提示：火箭兵克制坦克，步枪兵克制火箭兵。',
  '提示：Ctrl+数字键编队，双击选中同类单位。',
  '提示：A+左键攻击移动，部队会边推进边交战。',
  '提示：修建雷达站以启用小地图。',
  '提示：炮塔断电后射速减半——先打掉敌人电厂。',
];
