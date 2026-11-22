/**
 * 工具和事件的自描述。发布前由 tools/build-describe.mjs 从这里生成 describe.json；
 * tools() 也从这里取名字、说明和参数，两边不会漂。
 */
import { triggerOf } from './diff.js'

export const TOOL_DECLS = [
  {
    name: 'dota_status',
    summary: '读此刻这一局的战况卡',
    description:
      '读这一刻的 Dota 2 战况卡：是否在局中、英雄和等级、生命魔法、金钱、补刀、战绩、装备、复活和买活、比分、时间、昼夜、肉山。卡片是现读的，每次要用就调一次，别拿上一次的回执当现在。没在局中时给连接状态和上一局的数字。',
    parameters: { type: 'object', properties: {} },
    tags: ['read'],
  },
  {
    name: 'dota_events',
    summary: '查最近一段时间发生过的变化',
    description:
      '查最近一段时间里 Dota 2 里发生过的变化：阵亡、复活、升级、击杀、助攻、买到装备、拿到 A 杖、比分、肉山、塔被摧毁、暂停、开局和结束。用来回答「刚才那波怎么了」「这一会儿都发生了什么」。只保留内存里最近一小时的记录，重启后清空。',
    parameters: {
      type: 'object',
      properties: {
        minutes: {
          type: 'integer',
          description: '往回查多少分钟，1 到 60，默认 15。',
          minimum: 1,
          maximum: 60,
        },
        limit: {
          type: 'integer',
          description: '最多给几条，1 到 50，默认 20。按时间正序，最后一条最新。',
          minimum: 1,
          maximum: 50,
        },
      },
    },
    tags: ['read'],
  },
  {
    name: 'dota_match',
    summary: '一局的汇总',
    description:
      '给一局 Dota 2 的汇总：英雄、比分、时长、战绩、补刀、金钱、结局。正在打就给到此刻为止的；没在打就给最近结束的一局。想知道细节（血蓝、装备、复活）用 dota_status。',
    parameters: { type: 'object', properties: {} },
    tags: ['read'],
  },
  {
    name: 'dota_minimap',
    summary: '现读小地图位置库',
    description:
      '现读 Dota 2 小地图的位置库：己方队友的实时区域、敌方每个人最后露头的时间和区域、敌方名单确认进度、肉山状态（是否被杀、盾在谁手里、刷新倒计时）。只报区域不报坐标。什么时候值得看一眼：你阵亡等复活的时候、团战刚结束想复盘的时候、感觉有人 miss 要确认的时候、给战术建议之前。',
    parameters: { type: 'object', properties: {} },
    tags: ['read'],
  },
  {
    name: 'dota_mode',
    summary: '查或手动指定对局模式（加速/常规）',
    description:
      '查当前判定的对局模式和依据，或手动指定。模式决定提醒时刻表（莲花/圣水符/经验符的刷新时间）和肉山时刻。什么时候用手动：他说「这把是加速/普通模式」时按他说的设；你自己从对局信息确认自动判断错了也改（比如卡片标了常规但比分和节奏明显是加速）。设完立即生效并保留到设置里，重启不变；设回 auto 恢复自动推断。不带参数调用=只查不改。',
    parameters: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          description: '要设成的模式：turbo=加速、regular=常规、auto=恢复自动推断。不带这个参数就只查当前状态。',
          enum: ['turbo', 'regular', 'auto'],
        },
      },
    },
    tags: ['read'],
  },
]

export const EVENT_DECLS = [
  {
    type: 'dota.match.started',
    description: { zh: 'Dota 2 一局开始（进入选人或策略时间）。', en: 'A Dota 2 match started.' },
    trigger: triggerOf('dota.match.started'),
  },
  {
    type: 'dota.match.phase',
    description: { zh: '对局阶段变化：选人、策略时间、开局准备、对线开始。', en: 'The match phase changed.' },
    trigger: triggerOf('dota.match.phase'),
  },
  {
    type: 'dota.match.ended',
    description: { zh: '对局结束，带比分、时长和战绩。', en: 'The match ended with score and stats.' },
    trigger: triggerOf('dota.match.ended'),
  },
  {
    type: 'dota.match.left',
    description: { zh: '对局中途回到菜单，这一局没打完。', en: 'Left the match before it finished.' },
    trigger: triggerOf('dota.match.left'),
  },
  {
    type: 'dota.match.paused',
    description: { zh: '游戏暂停或继续。', en: 'The game was paused or resumed.' },
    trigger: triggerOf('dota.match.paused'),
  },
  {
    type: 'dota.match.disconnected',
    description: { zh: '超过 45 秒没有收到 Dota 2 数据。', en: 'No Dota 2 data for over 45 seconds.' },
    trigger: triggerOf('dota.match.disconnected'),
  },
  {
    type: 'dota.match.reconnected',
    description: { zh: '断线之后数据恢复。', en: 'Data resumed after a gap.' },
    trigger: triggerOf('dota.match.reconnected'),
  },
  {
    type: 'dota.player.died',
    description: { zh: '玩家阵亡，带复活倒计时和买活价格。', en: 'The player died; respawn timer and buyback included.' },
    trigger: triggerOf('dota.player.died'),
  },
  {
    type: 'dota.player.respawned',
    description: { zh: '玩家复活。', en: 'The player respawned.' },
    trigger: triggerOf('dota.player.respawned'),
  },
  {
    type: 'dota.match.lineup',
    description: { zh: '双方阵容确认（选人到落线 30 秒内）：你、队友、敌方各是什么英雄。', en: 'Both rosters are confirmed.' },
    trigger: triggerOf('dota.match.lineup'),
  },
  {
    type: 'dota.player.leveled',
    description: { zh: '英雄升到里程碑等级（6=大招解锁、15、25、30），跨级合并成一条。', en: 'The hero hit a level milestone (6/15/25/30).' },
    trigger: triggerOf('dota.player.leveled'),
  },
  {
    type: 'dota.player.killed',
    description: { zh: '玩家击杀数上升。', en: 'The player got a kill.' },
    trigger: triggerOf('dota.player.killed'),
  },
  {
    type: 'dota.player.assisted',
    description: { zh: '玩家助攻数上升。', en: 'The player got an assist.' },
    trigger: triggerOf('dota.player.assisted'),
  },
  {
    type: 'dota.player.item',
    description: { zh: '买到一件装备（消耗品除外）。', en: 'An item was acquired (consumables excluded).' },
    trigger: triggerOf('dota.player.item'),
  },
  {
    type: 'dota.player.upgrade',
    description: { zh: '拿到阿哈利姆神杖、魔晶或月之精华碎片。', en: 'Scepter, shard or moon shard acquired.' },
    trigger: triggerOf('dota.player.upgrade'),
  },
  {
    type: 'dota.player.buyback',
    description: { zh: '你买活了。', en: 'The player bought back.' },
    trigger: triggerOf('dota.player.buyback'),
  },
  {
    type: 'dota.fight.ended',
    description: { zh: '团战收口：≥2 杀的窗口结束，报几换几和关键人头。', en: 'A team fight wrapped up (2+ kills in the window).' },
    trigger: triggerOf('dota.fight.ended'),
  },
  {
    type: 'dota.intel.missing_all',
    description: { zh: '敌方五人同时消失 ≥10 秒。', en: 'All five enemies went missing for 10+ seconds.' },
    trigger: triggerOf('dota.intel.missing_all'),
  },
  {
    type: 'dota.intel.grouped',
    description: { zh: '敌方 ≥3 人同区域 ≥10 秒，抱团了。', en: '3+ enemies grouped in one area for 10+ seconds.' },
    trigger: triggerOf('dota.intel.grouped'),
  },
  {
    type: 'dota.intel.nearby',
    description: { zh: '消失 ≥20 秒的敌人出现在你附近。', en: 'A missing enemy reappeared near you.' },
    trigger: triggerOf('dota.intel.nearby'),
  },
  {
    type: 'dota.intel.roshan_threat',
    description: { zh: '敌方 ≥2 人进了肉山坑且肉山还活着。', en: '2+ enemies entered the Roshan pit while Roshan is alive.' },
    trigger: triggerOf('dota.intel.roshan_threat'),
  },
  {
    type: 'dota.map.score',
    description: { zh: '比分变化。', en: 'The score changed.' },
    trigger: triggerOf('dota.map.score'),
  },
  {
    type: 'dota.map.roshan',
    description: { zh: '肉山被击杀（带击杀方、盾的归属和刷新倒计时）或刷新。', en: 'Roshan was killed (with aegis carrier and respawn timer) or respawned.' },
    trigger: triggerOf('dota.map.roshan'),
  },
  {
    type: 'dota.map.building',
    description: { zh: '防御塔或兵营被摧毁：己方来自建筑血量，敌方来自小地图（带路别）。', en: 'A tower or barracks fell: own side from building HP, enemy side from the minimap.' },
    trigger: triggerOf('dota.map.building'),
  },
  {
    type: 'dota.map.daynight',
    description: { zh: '昼夜切换。', en: 'Day turned to night or back.' },
    trigger: triggerOf('dota.map.daynight'),
  },
  {
    type: 'dota.map.pickup',
    description: {
      zh: '固定时刻的拾取提醒，提前 30 秒，每局每条最多一次：莲花快熟（中单不提醒）、圣水符要出（只提醒中单）、第一颗经验符文要刷。例行通报：收到直接转告，一句带过，不分析。文案不带精确秒数、同类措辞轮换（延迟不可控）。时刻可在设置里改，填 0 关掉。',
      en: 'Timed pickup reminders 30s before lotus (not for mid), water rune (mid only) and the first wisdom rune. Mechanical relay: pass it on in one line, no analysis. Wording varies per reminder; no precise countdown. Times configurable; 0 disables.',
    },
    trigger: triggerOf('dota.map.pickup'),
  },
]
