import fs from 'fs/promises'
import path from 'path'
import util from 'util'
import readline from 'readline/promises'
import chalk from 'chalk'
import { parseString, Builder as xmlBuilder } from 'xml2js'
import minimist from 'minimist'
import { ffdecCommand, directoryExists } from './utils.js'

const __dirname = process.cwd()
const parseStringAsync = util.promisify(parseString)
const args = minimist(process.argv.slice(2))


const SWF_PATH = args._[0]

if (!SWF_PATH) {
    console.error('Please define the path to the SWF file, e.g. "npm run dev -- ./item.swf"')
    process.exit(1)
}

const SWF_PATH_JOINED = path.isAbsolute(SWF_PATH) ? SWF_PATH : path.join(__dirname, SWF_PATH)

const tempDir = 'temp__'

const swfName = path.parse(SWF_PATH).name

const XML_PATH = path.join(__dirname, tempDir, `${swfName}.xml`)

async function parseXMLToJSON(xml) {
    const XML = await fs.readFile(xml, 'utf8')
    const result = await parseStringAsync(XML)

    return result
}

function rgbToHex(r, g, b) {
    return '#' + (1 << 24 | Number(r) << 16 | Number(g) << 8 | Number(b)).toString(16).slice(1).toUpperCase()
}

function hexToRGB(hex) {
    const hexValue = hex.startsWith('#') ? hex.substring(1) : hex

    if (hexValue.length === 3) {
        const [r, g, b] = hexValue
        hexValue = r + r + g + g + b + b
    }

    const num = parseInt(hexValue, 16)

    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 }
}

function timelineRecursion(obj, predicate) {
    const results = []

    function search(node, key) {
        if (predicate(node, key)) {
            results.push(node)
        }

        if (Array.isArray(node)) {
            node.forEach(item => search(item, null))
        } else if (node && typeof node === 'object') {
            Object.keys(node).forEach(k => search(node[k], k))
        }
    }

    search(obj, null)
    return results
}

try {
    // For some reason the xml needs to exist first in order to work
    if (!(await directoryExists(path.join(__dirname, tempDir)))) {
        await fs.mkdir(path.join(__dirname, tempDir))
    }
    await fs.writeFile(XML_PATH, '')

    await ffdecCommand(`-swf2xml "${SWF_PATH_JOINED}" "${XML_PATH}"`)

    const data = await parseXMLToJSON(XML_PATH)

    const timeline = data.swf.tags[0].item

    const collectedColors = []

    const allColors = timelineRecursion(timeline, (_, key) => key === 'color').map(obj => obj[0].$)

    allColors.forEach(({ red, green, blue }) => {
        const hex = rgbToHex(red, green, blue)
        if (!collectedColors.includes(hex)) {
            collectedColors.push(hex)
        }
    })

    /**
     * Map of original color: new color
     */
    const recolorMap = {}

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    })

    function colorsMessage() {
        let text = ''
        text += 'The following colors were identified:\n'
        for (const hex of collectedColors) {
            text += `(${collectedColors.indexOf(hex) + 1}) ` + chalk.bgHex(hex)(hex + '     ')

            const { r, g, b } = hexToRGB(hex)
            const str = `${r},${g},${b}`

            if (str in recolorMap) {
                const [ r2, g2, b2 ] = recolorMap[str].split(',')
                const newHex = rgbToHex(r2, g2, b2)
                text += ` -> ${chalk.bgHex(newHex)(newHex + '     ')}`
            }

            text += '\n'
        }
        text += 'Enter the number or hex code you want to change, followed by the new hex code.\n'
        text += 'Examples (without quotes): "FFFF00 2E47AA", "2 F4F400"\n'
        text += 'After modifying colors, input "save" to save the SWF and exit the process. You can do Ctrl+C to exit at any time.'
        text += '\n> '
        return text
    }

    function logNote(msg) {
        console.log(`**********\n${msg}\n**********\n`)
    }

    function typeOfNumber(str) {
        const isInt = /^-?\d+$/.test(str)
        const isHex = /^#?[0-9A-Fa-f]{6}$/.test(str)

        if (isInt) return 'int'
        if (isHex) return 'hex'
        return null
    }

    function setRecolorMap(hex1, hex2) {
        const rgb1 = hexToRGB(hex1)
        const rgb2 = hexToRGB(hex2)

        recolorMap[`${rgb1.r},${rgb1.g},${rgb1.b}`] = `${rgb2.r},${rgb2.g},${rgb2.b}`
    }

    async function colorsQuestion() {
        // Delete any that are the same
        for (const key in recolorMap) {
            if (key === recolorMap[key]) {
                delete recolorMap[key]
            }
        }

        const input = await rl.question(colorsMessage())
        
        let [ firstColor, secondColor ] = input.split(' ')

        if (firstColor === 'save') {
            rl.close()

            if (Object.keys(recolorMap).length < 1) {
                console.log('No changes were made to the SWF.')
                await fs.rm(path.join(__dirname, tempDir), { recursive: true })
                return
            }

            console.log('Saving SWF...')

            allColors.forEach(color => {
                const key = `${color.red},${color.green},${color.blue}`
                if (key in recolorMap) {
                    const [ r, g, b ] = recolorMap[key].split(',')
                    color.red = r
                    color.green = g
                    color.blue = b
                }
            })

            const newXML = new xmlBuilder().buildObject(data)

            await fs.writeFile(XML_PATH, newXML)

            await ffdecCommand(`-xml2swf "${XML_PATH}" "${SWF_PATH_JOINED}"`)

            await fs.rm(path.join(__dirname, tempDir), { recursive: true })

            console.log('The SWF has been saved.')
            return
        }

        if (!firstColor || !secondColor) {
            logNote('Invalid format!')
            colorsQuestion()
            return
        }

        if (!secondColor.startsWith('#')) secondColor = '#' + secondColor.toUpperCase()

        const firstColorType = typeOfNumber(firstColor)
        const secondColorType = typeOfNumber(secondColor)

        if (secondColorType !== 'hex') {
            logNote('Second color is not in the correct format!')
            colorsQuestion()
            return
        }

        if (Number(firstColor) > 0 && Number(firstColor) <= collectedColors.length) {
            setRecolorMap(collectedColors[firstColor - 1], secondColor)
            logNote(`Sucessfully replaced color ${firstColor} with ${secondColor}`)
            colorsQuestion()
            return
        }

        if (!firstColor.startsWith('#')) firstColor = '#' + firstColor.toUpperCase()

        if (firstColorType !== 'hex') {
            logNote('First color is not in the correct format!')
            colorsQuestion()
            return
        }
        
        setRecolorMap(collectedColors[collectedColors.indexOf(firstColor)], secondColor)
        logNote(`Sucessfully replaced color ${firstColor} with ${secondColor}`)
        colorsQuestion()
    }

    colorsQuestion()
} catch (e) {
    console.error(e)
}