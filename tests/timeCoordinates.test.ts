import { describe, expect, it } from 'vitest'
import { formatCoordinateExample, parseTimeCoordinates } from '../src/utils/timeCoordinates'
import { analyzeText, messageScore, moodLevel } from '../src/utils/sentiment'

// 时间坐标模式的导入解析：文本 / CSV / JSON 三种来源。

describe('格式判定', () => {
  it('按扩展名判定', () => {
    expect(parseTimeCoordinates('[{"time":"08:30","text":"很好"}]', 'points.json').format).toBe('json')
    expect(parseTimeCoordinates('time,text\n08:30,很好', 'points.csv').format).toBe('csv')
    expect(parseTimeCoordinates('[08:30] 很好', 'points.txt').format).toBe('txt')
  })

  it('内容特征优先于扩展名', () => {
    expect(parseTimeCoordinates('{"points":[]}', 'unknown').format).toBe('json')
    expect(parseTimeCoordinates('time,text\n08:30,很好', 'unknown').format).toBe('csv')
  })

  it('声明为 JSON 但内容非法时给出错误而非中断导入', () => {
    const { points, errors } = parseTimeCoordinates('[08:30] 很好', 'points.json')
    expect(points).toHaveLength(0)
    expect(errors[0]).toContain('JSON 解析失败')
  })
})

describe('文本行解析', () => {
  it('方括号时间', () => {
    const { points, errors } = parseTimeCoordinates('[08:30] 今天很开心')
    expect(errors).toHaveLength(0)
    expect(points[0]?.time).toBe('08:30')
    expect(points[0]?.minutes).toBe(510)
    expect(points[0]?.text).toBe('今天很开心')
  })

  it('分行符支持逗号 / 制表符 / 空格', () => {
    for (const line of ['08:30,今天很开心', '08:30\t今天很开心', '08:30 今天很开心']) {
      const { points } = parseTimeCoordinates(line)
      expect(points[0]?.text, line).toBe('今天很开心')
    }
  })

  it('带日期前缀的时间戳', () => {
    const { points } = parseTimeCoordinates('2026-09-26 08:30 今天很开心')
    expect(points[0]?.time).toBe('08:30')
    expect(points[0]?.minutes).toBe(510)
  })

  it('秒被接受但不影响分钟坐标', () => {
    const { points } = parseTimeCoordinates('[08:30:45] 今天很开心')
    expect(points[0]?.time).toBe('08:30')
    expect(points[0]?.minutes).toBe(510)
  })

  it('内置示例可被自身解析', () => {
    const { points, errors } = parseTimeCoordinates(formatCoordinateExample())
    expect(errors).toHaveLength(0)
    expect(points).toHaveLength(3)
  })
})

describe('CSV 解析', () => {
  it('英文表头 time / text', () => {
    const { points, errors } = parseTimeCoordinates('time,text\n08:30,今天很开心\n12:45,工作有点压力')
    expect(errors).toHaveLength(0)
    expect(points.map((p) => p.time)).toEqual(['08:30', '12:45'])
  })

  it('中文表头 时间 / 内容', () => {
    const { points } = parseTimeCoordinates('时间,内容\n08:30,今天很开心')
    expect(points[0]?.time).toBe('08:30')
    expect(points[0]?.text).toBe('今天很开心')
  })

  it('无表头时按前两列取值', () => {
    const { points } = parseTimeCoordinates('08:30,今天很开心')
    expect(points[0]?.time).toBe('08:30')
    expect(points[0]?.text).toBe('今天很开心')
  })

  it('引号内的逗号不被拆列', () => {
    const { points } = parseTimeCoordinates('time,text\n08:30,"今天很开心, 真的"')
    expect(points[0]?.text).toBe('今天很开心, 真的')
  })

  it('空行被忽略', () => {
    const { points } = parseTimeCoordinates('time,text\n\n08:30,今天很开心\n')
    expect(points).toHaveLength(1)
  })
})

describe('JSON 解析', () => {
  it('顶层数组 + time / text', () => {
    const { points } = parseTimeCoordinates('[{"time":"08:30","text":"今天很开心"}]', 'a.json')
    expect(points[0]?.time).toBe('08:30')
    expect(points[0]?.text).toBe('今天很开心')
  })

  it('points 包裹结构与 data 包裹结构', () => {
    expect(parseTimeCoordinates('{"points":[{"time":"08:30","text":"今天很开心"}]}').points).toHaveLength(1)
    expect(parseTimeCoordinates('{"data":[{"time":"08:30","text":"今天很开心"}]}').points).toHaveLength(1)
  })

  it('字段别名 timestamp / content', () => {
    const { points } = parseTimeCoordinates('[{"timestamp":"08:30","content":"今天很开心"}]')
    expect(points[0]?.time).toBe('08:30')
    expect(points[0]?.text).toBe('今天很开心')
  })
})

describe('合法性校验与排序', () => {
  it('非法时刻被拒绝并记录错误', () => {
    expect(parseTimeCoordinates('[24:00] 今天很开心').points).toHaveLength(0)
    expect(parseTimeCoordinates('[24:00] 今天很开心').errors).toHaveLength(1)
    expect(parseTimeCoordinates('[08:60] 今天很开心').errors).toHaveLength(1)
  })

  it('缺少文本的记录进入错误列表', () => {
    const { points, errors } = parseTimeCoordinates('[08:30] \n[09:30] 今天很开心')
    expect(points).toHaveLength(1)
    expect(errors[0]).toContain('第 1 行')
  })

  it('结果按时间升序排列', () => {
    const { points } = parseTimeCoordinates('[19:20] 晚上很轻松\n[08:30] 今天很开心')
    expect(points.map((p) => p.time)).toEqual(['08:30', '19:20'])
  })

  it('分值复用情绪词典，与单条口径一致', () => {
    const { points } = parseTimeCoordinates('[08:30] 很开心')
    const raw = analyzeText('很开心').raw
    expect(points[0]?.score).toBeCloseTo(messageScore(raw), 10)
    expect(points[0]?.level).toBe(moodLevel(messageScore(raw)))
  })
})
