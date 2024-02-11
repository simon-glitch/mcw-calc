import 'dotenv/config'
import { Mwn } from 'mwn'
import { promises as fs } from 'node:fs'
import { DeployTarget, targets } from './deployConfig'

const env = process.env

const manifest = await fs.readFile('./dist/manifest.json', {
  encoding: 'utf-8',
})
const filesProd = JSON.parse(manifest).prod as string[]
const filesDev = JSON.parse(manifest).dev as string[]

const definitionProd = await fs.readFile('./dist/Gadgets-definition', {
  encoding: 'utf-8',
})
const definitionDev = await fs.readFile('./dist/Gadgets-definition.dev', {
  encoding: 'utf-8',
})

Promise.all(
  targets.map((target) =>
    target.type === 'production'
      ? update(target, filesProd, definitionProd)
      : update(target, filesDev, definitionDev),
  ),
)

async function update(target: DeployTarget, names: string[], definition: string) {
  const bot = await Mwn.init({
    apiUrl: target.apiUrl,

    username: env[`USERNAME_${target.credentials}`],
    password: env[`PASSWORD_${target.credentials}`],

    userAgent: env.USER_AGENT ?? 'MCWCalcDeploy (mwn/1; +https://github.com/mc-wiki/mcw-calc)',

    defaultParams: {
      assert: 'user',
    },
  })
  const files = names.map((file) => `./dist/${file}`)
  console.log(`Updating for ${target.name}: ${names.join(', ')}`)

  files.forEach(async (path, index) => {
    const file = await fs.readFile(path, { encoding: 'utf-8' })
    if (names[index] !== 'Gadgets-definition') {
      await bot.save(
        `MediaWiki:${names[index]}`,
        file,
        `Bot: Automatically deploy changes from Git`,
      )
      console.log(`Deployed ${names[index]} to ${target.name}`)
    }
  })

  bot.edit('MediaWiki:Gadgets-definition', (rev) => {
    // Replace content between two <!-- Automatically generated, your edit will be overwritten -->

    const section = rev.content.match(
      /<!-- Automatically generated, your edit will be overwritten -->\n((.|\n)+)\n<!-- Automatically generated, your edit will be overwritten -->/,
    )![1]
    const text = rev.content.replace(section, definition)
    return {
      text: text,
      summary: `Bot: Automatically deploy changes from Git`,
    }
  })
}
