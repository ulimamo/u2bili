import { bilibiliCookies, showBrowser, downloadPath } from "./config.js"
import { firefox as browserCore } from "playwright"
import { existsSync, readFileSync, writeFileSync } from "fs"
import { sendMail } from './mail.js'
/**
 * 使用例 node upload.sh MetaFile [VideoFile]
 * MetaFile 是必须的
 * 如果视频文件命名和Meta文件一致则可不写
 */
const uploadPageUrl = "https://member.bilibili.com/york/videoup"

if (process.argv.length < 3) {
  console.error(
    "至少传入视频信息JSON路径 node upload.js json_file [video_file]"
  )
  process.exit(-1)
}

var [metaPath, videoPath] = process.argv.slice(2, 4)
const meta = JSON.parse(readFileSync(metaPath))

function getCookies() {
  const envCookies = process.env["BILIBILI_COOKIE"]
  if (envCookies) {
    console.log("从环境变量读取Cookie")
    return envCookies.split(";").map((i) => {
      const [key, value] = i.split("=")
      return {
        domain: ".bilibili.com",
        path: "/",
        name: key,
        value: value,
      }
    })
  } else {
    console.log("从.env读取Cookie")
    return Object.keys(bilibiliCookies).map((k) => {
      return {
        domain: ".bilibili.com",
        path: "/",
        name: k,
        value: bilibiliCookies[k],
      }
    })
  }
}

async function main() {
  const title = await translate(meta["title"])
  const browser = await browserCore.launch({
    headless: !showBrowser,
  })
  const context = await browser.newContext({
    recordVideo: { dir: "videos/" },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.182 Safari/537.36 Edg/88.0.705.74",
    storageState: {
      origins: [
        {
          origin: "https://member.bilibili.com",
          localStorage: [
            {
              name: "SHOW_GUIDE",
              value: "1",
            },
            {
              name: "bili_videoup_submit_auto_tips",
              value: "1"
            }
          ],
        },
      ],
    },
  })
  await context.addCookies(getCookies())
  const page = await context.newPage()
  try {
    await Promise.all([
      page.goto(uploadPageUrl, {
        waitUntil: "networkidle",
        timeout: 20 * 1000,
      }),
      page.waitForResponse(/\/OK/), //Fix：库未加载完的无效点击
    ])
  } catch (error) {
    if (error.name === "TimeoutError") {
      console.error(
        `::error file=upload.js::等待上传页面超时! 当前页面:${page.url()}`
      )
    }
  }
  let fileChooser = null
  try {
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 10_000 }),
      page.click(".upload-btn"),
    ])
    fileChooser = chooser
  } catch (error) {
    if (error.name === "TimeoutError") {
      console.error(`::error::点击上传按钮超时! 当前页面:${page.url()}`)
    }
  }

  if (!videoPath) {
    const ext = ["webm", "mp4", "mkv"].find((ext) =>
      existsSync(`${downloadPath}${meta["id"]}.${ext}`)
    )
    if (!ext) {
      console.error(
        `::error::无法在${downloadPath}找到${meta["id"]}命名的视频文件，上传未成功。`
      )
      process.exit(-1)
    }
    videoPath = `${downloadPath}${meta["id"]}.${ext}`
  }
  await fileChooser.setFiles(videoPath)
  console.log(`开始上传${videoPath}`)

  await page.click('text="转载"')
  await page.fill("input[placeholder^=转载视频请注明来源]", meta["webpage_url"])

  // 选择分区
  // await page.click("div.select-box-v2-container")
  // await page.click('text="知识"')
  // await page.click("div.drop-cascader-list-wrp > div:nth-child(8)") // 修复问题:找不到二级选项导致堵塞，数字对应二级列表位置

  // 创建标签
  await page.click("input[placeholder*=创建标签]")
  await page.keyboard.type(meta["uploader"])
  await page.keyboard.down("Enter")

  // 视频描述
  await page.click("div.ql-editor[data-placeholder^=填写更全]")
  // await page.keyboard.type(`u2bili自动上传\n${meta["description"].slice(0, 200)}`)

  await page.fill("input[placeholder*=标题]", 'Boki x ' + title)

  await uploadSubtitles(page, meta)

  // 上传封面
  try {
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 10_000 }),
      page.click(".cover-upload"),
    ])
    await chooser.setFiles(`${downloadPath}${meta["id"]}.webp`)
    await page.click('text="完成"')
  } catch (error) {
    console.error('上传封面失败，使用自动生成的封面', error.message)
    await page
    .waitForSelector('text="更改封面"', {
      timeout: 3 * 60_000, // 等待自动生成封面
    })
    .catch(() => {
      console.log("等待封面自动生成时间过长")
    })
  }

  await page
    .waitForSelector('text="上传完成"', {
      timeout: 10 * 60_000, // 等待上传完毕
    })
    .catch(() => {
      console.log("上传时间过长")
    })

  await page.click('text="立即投稿"')

  await page.waitForTimeout(3000)
  await page.close()
  await context.close()
  await browser.close()

  // 上传成功后邮件通知
  await sendMail({
    subject: `youtube视频更新 ${title}`,
    content: [
      `标题: ${meta["title"]}`,
      `链接：${meta["webpage_url"]}`,
      `频道：${meta["channel"]}`,
    ].join('\n')
  })
}

async function vtt2srt(path) {
  if (!existsSync(path)) return

  let num = 1
  const vtt = readFileSync(path, "utf-8")
  // 去除头部meta信息，改为逗号分割，增加序号，空行修整
  let srt = vtt
    .split("\n")
    .slice(4)
    .join("\n")
    .replace(
      /(\d{2}:\d{2}:\d{2}.\d{3} --> \d{2}:\d{2}:\d{2}.\d{3})/g,
      (match, p1) => {
        return `${num++}\n${p1.replaceAll(".", ",")}`
      }
    )
    .replace(/\n+$/g, "")

  writeFileSync(path, srt)
}

async function uploadSubtitles(page, meta) {
  // 寻找中文字幕和英文字幕
  const langCodes = Object.keys(meta["subtitles"])
  const enSub = langCodes.find((code) => code.startsWith("en"))
  const zhSub = langCodes.find((code) => code.startsWith("zh-Hans") || code.startsWith("zh"))

  if (!enSub && !zhSub) return

  await page.click('text="更多设置"')

  await page.click('text="上传字幕"')

  async function selectSub(lang, path) {
    if (!existsSync(path)) return

    await page.click(`[placeholder="选择字幕语言"]`)
    await page.click(`li:has-text("${lang}")`)

    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 10_000 }),
      page.click(".modal-content-upload button"),
    ])

    await chooser.setFiles(path)
  }

  if (zhSub) {
    const subPath = `${downloadPath}${meta["id"]}.${zhSub}.vtt`
    vtt2srt(subPath)
    await selectSub("中文", subPath)
    console.log("已添加中文字幕")
  }

  if (enSub) {
    const subPath = `${downloadPath}${meta["id"]}.${enSub}.vtt`
    vtt2srt(subPath)
    await selectSub("英语", subPath)
    console.log("已添加英文字幕")
  }

  await page.click('text="确认"')

  // 即使格式错误也继续上传
  await page
    .click('text="取消"', { timeout: 1000, delay: 1000 })
    .catch(() => {})
}

async function translate(sourceText) {
  const browser = await browserCore.launch({
    headless: !showBrowser,
  })
  const context = await browser.newContext();
  const page = await context.newPage()
  await page.goto('http://www.iciba.com/translate');
  await page.locator('div').filter({ hasText: /^自动选择语言 重点词汇整理文本0\/3000$/ }).locator('div').nth(1).click();
  await page.locator('div').filter({ hasText: /^自动选择语言 重点词汇整理文本0\/3000$/ }).locator('div').nth(1).fill(sourceText);
  let text = await page.getByRole('paragraph').textContent({timeout: 5000});
  page.close();
  browser.close();
  return text;
}

main()
