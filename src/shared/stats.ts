// 复习统计指标计算(Feature ④ Phase 3).
//
// Pure functions, zero deps. 从一组可复习项的 SRSState 计算聚合指标,
// 用于句库/生词本抽屉顶部的统计条,给学习者正反馈。
//
// 所有指标从现有 SRSState 字段计算,不新增持久化字段,零数据迁移风险。

import { isDue, type SrsState } from './srs'

/** 一个可复习项:只要有 srs 字段(SrsState 或 null)即可参与统计。*/
export interface Reviewable {
  srs: SrsState | null
}

/** 聚合统计结果。*/
export interface ReviewStats {
  /** 待复习数(isDue 为真)。仅算 srs !== null 的项。*/
  due: number
  /** 已掌握数(reps >= 3,视为初步掌握)。*/
  mastered: number
  /** 总复习次数(所有项 reps 之和)。*/
  totalReviews: number
  /** 平均掌握度(所有 srs!==null 项的 ease 均值,1 位小数)。无项时为 0。*/
  avgEase: number
}

/** 掌握阈值:复习过 3 次以上视为初步掌握。*/
const MASTERED_REPS = 3

/**
 * 计算一组可复习项的聚合统计。srs 为 null 的项(被动参考)被跳过。
 * 纯函数,不 mutate 输入。
 */
export function computeReviewStats(items: Reviewable[]): ReviewStats {
  let due = 0
  let mastered = 0
  let totalReviews = 0
  let easeSum = 0
  let reviewableCount = 0

  for (const it of items) {
    if (!it.srs) continue
    reviewableCount += 1
    totalReviews += it.srs.reps
    easeSum += it.srs.ease
    if (isDue(it.srs)) due += 1
    if (it.srs.reps >= MASTERED_REPS) mastered += 1
  }

  const avgEase = reviewableCount > 0 ? Math.round((easeSum / reviewableCount) * 10) / 10 : 0

  return { due, mastered, totalReviews, avgEase }
}
