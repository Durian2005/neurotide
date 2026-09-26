// 内置示例聊天记录生成器：确定性伪随机，保证每次生成的图案一致
// 输出格式与 parser.ts 的解析规则完全一致：[YYYY-MM-DD HH:mm:ss] 昵称: 内容

const POSITIVE_LINES: string[] = [
  '今天心情特别好，天气也很棒，做什么都很顺利。',
  '和朋友一起吃了顿好的，聊得特别开心，谢谢你们陪我。',
  '收到了期待已久的包裹，拆开的那一刻惊喜到尖叫，哈哈。',
  '项目终于上线了，虽然过程很累，但结果完美，值得庆祝。',
  '早上跑步遇到了很美的日出，整个人都充满元气。',
  '被同事夸了一句方案写得精彩，偷偷开心了一整天。',
  '给妈妈打了电话，她说家里一切都好，听完很安心。',
  '看了一场很治愈的电影，出来的时候觉得世界都温柔了。',
  '今天把拖了很久的事情做完了，特别满足，很有成就感。',
  '遇到了很友善的陌生人，主动帮我抬行李，感动。',
  '晚饭做了红烧肉，居然一次成功，好吃到想给自己鼓掌。',
  '收到了好消息，努力终于被看见，太幸运了。',
  '周末去爬山，山顶的风和云都美得不像话，太精彩了。',
  '养的绿萝长出新叶子了，小小的生命让我觉得很温暖。',
  '和很久没联系的朋友聊了两个小时，回忆起来都是欢乐。',
]

const NEGATIVE_LINES: string[] = [
  '加班到很晚才回家，真的好累，心里有点难过。',
  '又失眠了，脑子里全是没做完的事情，特别焦虑。',
  '方案被打回来了，有点失落，感觉自己的努力被否定。',
  '和室友因为小事吵架了，现在很生气，也很委屈。',
  '感冒了，头疼嗓子疼，一个人去买药的时候有点想哭。',
  '地铁上被人挤了一路，特别烦躁，一天的心情都很糟糕。',
  '体检报告有个指标不太好，很担心，压力一下子上来了。',
  '计划好的旅行因为下雨取消了，好遗憾，整个人很丧。',
  '被误解了却没法解释，心里堵得慌，特别难受。',
  '半夜被噪音吵醒，醒来后再也睡不着，烦躁到抓狂。',
  '想到未来就觉得很迷茫，不知道自己到底在做什么。',
  '手机摔碎了屏幕，预感这周会很倒霉，果然又出了差错。',
  '今天一整天都很低落，什么都不想做，只想躺着。',
  '重要的演示说错了话，回来后一直自责，很无力。',
  '朋友很久没回我消息，有点孤独，也怀疑是不是自己做错了什么。',
]

const NEUTRAL_LINES: string[] = [
  '今天没什么特别的事，平平淡淡地过了一天。',
  '照常上班下班，晚上看了会儿书就睡了。',
  '天气一般，处理了几封邮件，把待办清了一下。',
  '中午吃了食堂，下午开会，一天就这么过去了。',
  '整理了一下桌面，扔掉不少没用的东西，心情平静。',
  '今天走得早，路上听了两集播客，没什么特别的感受。',
  '例行复查，结果和上次一样，继续按计划来就好。',
  '做了一天的报表，数字都核对完了，还算踏实。',
]

const MIXED_LINES: string[] = [
  '今天有点累，不过把一直想做的事完成了，还是挺开心的。',
  '白天被批评了有点难过，晚上朋友请我吃饭，心情好了一些。',
  '早上很焦虑，下午把最难的部分搞定后，突然轻松了。',
  '虽然加班很烦，但拿到了想要的资源，也算值得。',
  '一开始担心做不好，结果比预期顺利，松了一口气。',
]

function createRandom(seed: number): () => number {
  let state = seed % 4294967296
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

// 生成从 2025-12-01 到 2026-09-25 的示例聊天记录
export function buildSampleChatLog(): string {
  const random = createRandom(20260926)
  const lines: string[] = []
  const start = new Date(2025, 11, 1)
  const end = new Date(2026, 8, 25)

  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    // 约 18% 的日子没有记录，形成自然空缺
    if (random() < 0.18) continue

    const dateKey = `${cursor.getFullYear()}-${pad2(cursor.getMonth() + 1)}-${pad2(cursor.getDate())}`
    // 用正弦波模拟心情起伏：一段时间偏好，一段时间低落
    const wave = Math.sin(((cursor.getTime() - start.getTime()) / 86_400_000 / 26) * Math.PI * 2)
    const positiveChance = 0.42 + wave * 0.28
    const count = 1 + Math.floor(random() * 3)

    for (let i = 0; i < count; i++) {
      const roll = random()
      let content: string
      if (roll < 0.1) content = MIXED_LINES[Math.floor(random() * MIXED_LINES.length)]
      else if (roll < 0.1 + positiveChance) {
        content = POSITIVE_LINES[Math.floor(random() * POSITIVE_LINES.length)]
      } else if (roll < 0.1 + positiveChance + (1 - positiveChance) * 0.75) {
        content = NEGATIVE_LINES[Math.floor(random() * NEGATIVE_LINES.length)]
      } else {
        content = NEUTRAL_LINES[Math.floor(random() * NEUTRAL_LINES.length)]
      }

      const hour = 7 + Math.floor(random() * 16)
      const minute = Math.floor(random() * 60)
      const second = Math.floor(random() * 60)
      const stamp = `${dateKey} ${pad2(hour)}:${pad2(minute)}:${pad2(second)}`
      const nickname = random() < 0.85 ? '我' : '小林'
      lines.push(`[${stamp}] ${nickname}: ${content}`)
    }
  }

  return lines.join('\n')
}