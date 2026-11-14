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
    type: 'dota.player.leveled',
    description: { zh: '英雄升级。', en: 'The hero leveled up.' },
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
    type: 'dota.map.score',
    description: { zh: '比分变化。', en: 'The score changed.' },
    trigger: triggerOf('dota.map.score'),
  },
  {
    type: 'dota.map.roshan',
    description: { zh: '肉山被击杀或刷新（这一版 GSI 暂不提供）。', en: 'Roshan was killed or respawned (not sent by this GSI version).' },
    trigger: triggerOf('dota.map.roshan'),
  },
  {
    type: 'dota.map.building',
    description: { zh: '防御塔或兵营被摧毁（只报自己这边）。', en: 'A tower or barracks was destroyed (own side only).' },
    trigger: triggerOf('dota.map.building'),
  },
  {
    type: 'dota.map.daynight',
    description: { zh: '昼夜切换。', en: 'Day turned to night or back.' },
    trigger: triggerOf('dota.map.daynight'),
  },
]
