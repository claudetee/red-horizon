// RED HORIZON — all balance & content tables. Single tuning surface.

export const PLAYER = 0, ENEMY = 1;

// game pace: epic mode stretches a match to 20-120 minutes
export const PACE = {
  standard: { cn: '标 准', build: 1, hp: 1, ore: 1, oreRegen: 1, wave: 1, superMul: 1 },
  epic:     { cn: '史 诗', build: 2.6, hp: 1.8, ore: 2.5, oreRegen: 2.2, wave: 2.1, superMul: 2 },
};
let paceMult = PACE.standard;
export function setPace(key) { paceMult = PACE[key] || PACE.standard; return paceMult; }
export function pace() { return paceMult; }

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
  artySalvo:  { dmg: 32, rof: 5.2, range: 8.6, kind: 'shell', speed: 175, splash: 24, burst: 4, burstGap: 0.22,
                arcH: 34, trail: true,
                vs: { inf: 0.85, light: 0.8, heavy: 0.65, building: 1.35 }, sfx: 'rocket' },
  teslaZap:   { dmg: 95, rof: 2.6, range: 6.0, kind: 'tesla', chain: 2, chainDmg: 48, burst: 1,
                vs: { inf: 1.25, light: 1.0, heavy: 1.0, building: 0.5 }, sfx: 'tesla' },  // extra vs organic
  fieldCannon: { dmg: 85, rof: 3.4, range: 7.6, kind: 'shell', speed: 300, splash: 20, burst: 1, arcH: 22,
                vs: { inf: 0.7, light: 1.0, heavy: 1.0, building: 1.1 }, sfx: 'cannon2' },
};

export const BUILDINGS = {
  conyard: {
    cn: '建 造 厂', en: 'CONSTRUCTION YARD', cost: 2500, hp: 1500, power: 0,
    fw: 3, fh: 3, sight: 6, sprite: 'bld_conyard', buildable: false, produces: 'veh',
    gridRange: 7,
    desc: '基地核心，生产工程车并提供基础供电范围。失去所有建筑即战败。',
  },
  power: {
    cn: '发 电 厂', en: 'POWER PLANT', cost: 300, hp: 400, power: +100,
    fw: 2, fh: 2, sight: 4, sprite: 'bld_power', buildable: true, hotkey: 'Q',
    gridRange: 9,
    desc: '提供 100 电力与 9 格供电范围。高级设施必须建在电网内。',
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
    prereq: ['refinery'], needsGrid: true,
    desc: '启用小地图雷达，并解锁重型科技。需在供电范围内。',
  },
  turret: {
    cn: '防 御 炮 塔', en: 'GUN TURRET', cost: 500, hp: 450, power: -20,
    fw: 1, fh: 1, sight: 7, sprite: 'bld_turret', turretSprite: 'bld_turret_gun',
    buildable: true, hotkey: 'Y', prereq: ['barracks'], weapon: 'turretGun',
    desc: '自动炮塔，克制载具。断电时射速减半。',
  },
  repair: {
    cn: '维 修 平 台', en: 'REPAIR PLATFORM', cost: 600, hp: 400, power: -15,
    fw: 1, fh: 1, sight: 3, sprite: 'bld_repair', buildable: true, hotkey: 'U',
    prereq: ['factory'], repairAura: { range: 105, rate: 9 }, needsGrid: true,
    desc: '自动修理附近的友方机械单位（消耗资金）。需在供电范围内。',
  },
  tesla: {
    cn: '特 斯 拉 塔', en: 'TESLA TOWER', cost: 1200, hp: 500, power: -50,
    fw: 1, fh: 1, sight: 7.5, sprite: 'bld_tesla', buildable: true, hotkey: 'I',
    prereq: ['radar'], weapon: 'teslaZap', needsGrid: true,
    desc: '链式闪电防御塔，对生物单位加伤。断电或脱网时完全失效。',
  },
  silo: {
    cn: '导 弹 井', en: 'MISSILE SILO', cost: 2500, hp: 900, power: -75,
    fw: 2, fh: 2, sight: 4, sprite: 'bld_silo', buildable: true, hotkey: 'O',
    prereq: ['radar'], superweapon: { charge: 240, dmg: 950, splash: 130 }, unique: true, needsGrid: true,
    desc: '战略导弹：充能后可打击全图任意位置。每方限一座，需在电网内。',
  },
  shield: {
    cn: '护 盾 生 成 器', en: 'SHIELD GENERATOR', cost: 1600, hp: 500, power: -60,
    fw: 2, fh: 2, sight: 4, sprite: 'bld_shield', buildable: true, hotkey: 'P',
    prereq: ['radar'], needsGrid: true,
    shieldAura: { range: 150, frac: 0.32, regenDelay: 9, regenRate: 0.055 },
    desc: '为范围内友方建筑生成 32% 护盾层，脱战后缓慢再生。需在电网内。',
  },
  wall: {
    cn: '城 墙', en: 'FORTIFIED WALL', cost: 60, hp: 1100, power: 0,
    fw: 1, fh: 1, sight: 1, sprite: 'bld_wall', buildable: true, hotkey: 'J', wall: true,
    desc: '重型防御墙段。放置时按住拖动可连排铺设。',
  },
};

export const UNITS = {
  builder: {
    cn: '工 程 车', en: 'ENGINEER TRUCK', cost: 400, hp: 300, speed: 70, turn: 3.4,
    sight: 4.5, armor: 'light', weapon: null, r: 11, sprite: 'unit_builder',
    factory: 'conyard', hotkey: 'Q', kind: 'veh', builder: true,
    desc: '建造与维修基地建筑。多台同修一处可大幅加速。',
  },
  rifle: {
    cn: '步 枪 兵', en: 'RIFLEMAN', cost: 120, hp: 60, speed: 46, turn: 12,
    sight: 4.5, armor: 'inf', weapon: 'rifleMG', r: 5, sprite: 'unit_rifle',
    factory: 'barracks', hotkey: 'Q', kind: 'inf', organic: true,
    desc: '廉价主力步兵，克制敌方步兵。可操作野战炮、乘坐运兵艇。',
  },
  rocket: {
    cn: '火 箭 兵', en: 'ROCKETEER', cost: 300, hp: 55, speed: 40, turn: 12,
    sight: 5, armor: 'inf', weapon: 'rocket', r: 5, sprite: 'unit_rocket',
    factory: 'barracks', hotkey: 'W', kind: 'inf', organic: true,
    skill: { key: 'deploy', cn: '部 署', hk: 'F', toggle: true, rangeBonus: 1.3, desc: '架设发射位：射程 +1.3，无法移动' },
    desc: '反装甲步兵，克制载具与建筑。技能：部署 (F)。',
  },
  buggy: {
    cn: '侦 察 车', en: 'SCOUT BUGGY', cost: 600, hp: 230, speed: 128, turn: 4.6,
    sight: 6.5, armor: 'light', weapon: 'buggyMG', r: 10, sprite: 'unit_buggy',
    factory: 'factory', hotkey: 'W', kind: 'veh',
    skill: { key: 'sprint', cn: '冲 刺', hk: 'F', cd: 9, dur: 2.2, speedMul: 1.85, desc: '短暂爆发 +85% 移速' },
    desc: '高速侦察载具，机枪克制步兵。技能：冲刺 (F)。',
  },
  harvester: {
    cn: '采 矿 车', en: 'ORE HARVESTER', cost: 1200, hp: 650, speed: 62, turn: 3.2,
    sight: 4, armor: 'heavy', weapon: null, r: 13, sprite: 'unit_harvester',
    factory: 'factory', hotkey: 'E', kind: 'veh', harvester: true,
    desc: '自动采集矿石并运回精炼厂。',
  },
  tank: {
    cn: '中 型 坦 克', en: 'MEDIUM TANK', cost: 900, hp: 430, speed: 74, turn: 2.9,
    sight: 5.5, armor: 'heavy', weapon: 'cannon', r: 11, sprite: 'unit_tank_hull',
    turretSprite: 'unit_tank_gun', turretTurn: 4.2,
    factory: 'factory', hotkey: 'R', kind: 'veh',
    desc: '主战坦克，装甲对决的中坚。',
  },
  heavy: {
    cn: '猛 犸 重 坦', en: 'MAMMOTH TANK', cost: 1750, hp: 980, speed: 50, turn: 2.0,
    sight: 6, armor: 'heavy', weapon: 'twinCannon', r: 14, sprite: 'unit_heavy_hull',
    turretSprite: 'unit_heavy_gun', turretTurn: 3.2,
    factory: 'factory', hotkey: 'T', kind: 'veh', prereqBld: ['radar'],
    selfRepair: { below: 0.5, rate: 6 },
    desc: '双管重型坦克，需雷达站解锁。被动：低于半血时战场自修。',
  },
  artillery: {
    cn: '火 箭 炮 车', en: 'ROCKET ARTILLERY', cost: 1300, hp: 190, speed: 55, turn: 2.4,
    sight: 6, armor: 'light', weapon: 'artySalvo', r: 12, sprite: 'unit_artillery',
    factory: 'factory', hotkey: 'Y', kind: 'veh', prereqBld: ['radar'], minRange: 2.6,
    desc: '远程火箭齐射，攻城利器。脆弱且有最小射程——保护好它。',
  },
  fieldgun: {
    cn: '野 战 炮', en: 'FIELD GUN', cost: 700, hp: 330, speed: 26, turn: 1.7,
    sight: 5.5, armor: 'light', weapon: 'fieldCannon', r: 12, sprite: 'unit_fieldgun',
    factory: 'factory', hotkey: 'U', kind: 'veh', minRange: 1.2,
    crewed: { max: 2, fireNeed: 1, moveNeed: 2 },
    desc: '牵引重炮：1 名步兵操作即可开火，2 名可推行转移。空炮可被任意步兵接管——包括敌人。',
  },
  hovercraft: {
    cn: '气 垫 运 兵 艇', en: 'HOVERCRAFT', cost: 900, hp: 430, speed: 96, turn: 3.0,
    sight: 5, armor: 'light', weapon: null, r: 14, sprite: 'unit_hovercraft',
    factory: 'factory', hotkey: 'I', kind: 'veh', amphibious: true,
    transport: { cap: 12 },
    desc: '水陆两栖运兵艇：可载 12 名步兵横渡水域，开辟奇袭航线。',
  },
};

export const ECON = {
  startCredits: 6000,
  siteInitHpFrac: 0.1,     // construction site starts at 10% of final hp
  builderBoost: 0.6,       // each extra builder on a site adds +60% speed
  builderMax: 4,           // builders that can work one site simultaneously
  buildReach: 46,          // px beyond footprint edge where a builder can work
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

export const BUILD_TIME = cost => (1.2 + cost / 300) * paceMult.build; // seconds

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
  needBuilder:          { t: '需要工程车', cls: '' },
  building:             { t: '开始施工', cls: 'good' },
  needMoreOre:          { t: '矿脉枯竭，寻找新矿区', cls: '' },
  victory:              { t: '任务完成', cls: 'gold' },
  defeat:               { t: '任务失败', cls: '' },
  siloReady:            { t: '战略导弹就绪', cls: 'gold' },
  nukeLaunch:           { t: '战略导弹已发射', cls: 'gold' },
  nukeIncoming:         { t: '警告：敌方战略导弹来袭', cls: '' },
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
