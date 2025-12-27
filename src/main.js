import fs from 'fs/promises'
import path from 'path'
import util from 'util'
import { JSDOM } from 'jsdom'
import { parseString } from 'xml2js'
import sharp from 'sharp'
import minimist from 'minimist'
import pLimit from 'p-limit'
import { runCommand, ffdecCommand, directoryExists } from './utils.js'

const __dirname = process.cwd()
const parseStringAsync = util.promisify(parseString)
const args = minimist(process.argv.slice(2))
const limit = pLimit(4)


const SWF_PATH = args._[0]

if (!SWF_PATH) {
    console.error('Please define the path to the SWF file, e.g. "npm run dev -- ./item.swf"')
    process.exit(1)
}

const DONT_PACK = Boolean(args.dontpack || args.dp)
const SAVE_OUTPUT = Boolean(args.saveoutput || args.so)
const _outputdir = args.outputdir || args.od
const OUTPUT_DIR = !_outputdir ? null : path.isAbsolute(_outputdir) ? _outputdir : path.join(__dirname, _outputdir)
const CANVAS_SIZE = process.env.CANVAS_SIZE?.length ? Number(process.env.CANVAS_SIZE) : 400
const SCALE_MULTIPLIER = process.env.SCALE_MULTIPLIER?.length ? Number(process.env.SCALE_MULTIPLIER) : 5
const PNG_COMPRESSION = process.env.PNG_COMPRESSION?.length ? Number(process.env.PNG_COMPRESSION) : 8
const SUBLENGTH_MAP_ARGS = args.sublengths || args.sl

const sublengthMap = function() {
    if (SUBLENGTH_MAP_ARGS?.length > 0) {
        const split = SUBLENGTH_MAP_ARGS.split(',').filter(s => s.length > 0)
        const entries = []
        for (const map of split) {
            const splitMap = map.split(':')
            if (splitMap.length === 2) {
                entries.push(splitMap.map(Number))
            } else {
                console.error('Sublength map is not formatted correctly! Must be {frame}:{sublength}, separated by commas (e.g. 9:4,26:2 ...)')
                process.exit(1)
            }
        }

        return Object.fromEntries(entries)
    }

    return {}
}()

const tempDir = 'temp__'

const swfName = path.parse(SWF_PATH).name

const XML_PATH = path.join(__dirname, tempDir, `${swfName}.xml`)

async function parseXMLToJSON(xml) {
    const XML = await fs.readFile(xml, 'utf8')
    const result = await parseStringAsync(XML)

    return result
}

async function updateSVGSizing(svgPath, width, height) {
    const svgString = await fs.readFile(svgPath, 'utf8')

    const dom = new JSDOM(svgString, { contentType: 'image/svg+xml' })
    const svg = dom.window.document.querySelector('svg')

    svg.setAttribute('viewBox', `${-(width / 2)} ${-(height / 2)} ${width} ${height}`)
    svg.setAttribute('width', width)
    svg.setAttribute('height', height)

    return Buffer.from(dom.serialize())
}

try {
    // For some reason the xml needs to exist first in order to work
    if (!(await directoryExists(path.join(__dirname, tempDir)))) {
        await fs.mkdir(path.join(__dirname, tempDir))
    }
    await fs.writeFile(XML_PATH, '')

    await ffdecCommand(`-swf2xml "${path.isAbsolute(SWF_PATH) ? SWF_PATH : path.join(__dirname, SWF_PATH)}" "${XML_PATH}"`)

    const data = await parseXMLToJSON(XML_PATH)

    const totalFrames = parseInt(data.swf.$.frameCount)

    const timeline = data.swf.tags[0].item

    // timeline will be spliced; this one won't, so we can reference it later
    const timelineSafe = [...timeline]

    const outputPath = path.join(__dirname, 'exports', swfName)

    const charDepthIdMap = {}

    let prevLength = null

    const exportCallbacks = []

    async function exportFrames(currentFrame, sublength) {
        await ffdecCommand(`-config svgRetainBounds=true -format frame:svg -select ${currentFrame} -sublength ${sublength} -ignorebackground -zoom 2 -export frame "${outputPath}" "${SWF_PATH}"`)

        const frameSubDir = path.join(outputPath, `${currentFrame}`)
        if (await directoryExists(frameSubDir)) {
            const fileNames = await fs.readdir(frameSubDir)
            for (const fileName of fileNames) {
                await fs.rename(path.join(frameSubDir, fileName), path.join(frameSubDir, `../${currentFrame}_${fileName}`))
            }
            await fs.rm(frameSubDir, { recursive: true })
        } else {
            await fs.rename(path.join(outputPath, `${currentFrame}.svg`), path.join(outputPath, `${currentFrame}_1.svg`))
        }

        console.log(`Finished exporting frame ${currentFrame}`)
    }

    for (let currentFrame = 1; currentFrame <= totalFrames; currentFrame++) {
        console.log('-----------')
        console.log('Processing frame:', currentFrame)
        // Get all tags for this frame
        const ftIndex = timeline.findIndex(item => item.$?.type === 'ShowFrameTag')
        const tagsOnThisFrame = timeline.slice(0, ftIndex)
        timeline.splice(0, ftIndex + 1)

        if (timeline.length === prevLength) {
            console.log('Skipping this frame, because there were no new changes on the timeline')
        }

        prevLength = timeline.length

        const placeObjectTags = tagsOnThisFrame.filter(item => item.$?.type === 'PlaceObject2Tag')

        if (placeObjectTags.length < 1) {
            console.log('Skipping this frame, because there were no detected objects placed')
            continue
        }

        let sublength = 0

        if (currentFrame in sublengthMap) {
            sublength = sublengthMap[currentFrame]
        } else {
            // Find the sprite with the most amount of frames;
            // this is what we will use as the sublength for the export
            const frameLengths = []

            for (const tag of placeObjectTags) {
                if (tag.$?.characterId === '0') {
                    tag.$.characterId = charDepthIdMap[tag.$.depth]
                }

                charDepthIdMap[tag.$.depth] = tag.$.characterId

                const defineSprite = timelineSafe.find(item => item.$?.type === 'DefineSpriteTag' && item.$?.spriteId === tag.$?.characterId)
                if (!defineSprite) continue
                frameLengths.push(Number(defineSprite.$.frameCount))
            }

            if (frameLengths.length < 1) {
                frameLengths.push(1)
            }

            sublength = Math.max(...frameLengths)
        }

        console.log('Sublength:', sublength)

        exportCallbacks.push(exportFrames(currentFrame, sublength))
    }

    await Promise.all(exportCallbacks)

    // Now we begin to convert the SVGs to PNGs

    const entries = await fs.readdir(outputPath, { withFileTypes: true })

    const outputFiles = []

    async function convertSVGToPNG(file, fullPath) {
        if (path.extname(file) === '.svg') {
            const svgPath = path.join(fullPath, file)

            const svgBuffer = await updateSVGSizing(svgPath, CANVAS_SIZE, CANVAS_SIZE)
            const pngOutput = sharp(svgBuffer).resize(CANVAS_SIZE * SCALE_MULTIPLIER).sharpen().png()

            const pngPath = path.join(fullPath, `${path.basename(file, '.svg')}.png`)

            const resized = sharp(await pngOutput.toBuffer())
                .resize(CANVAS_SIZE, CANVAS_SIZE, { kernel: sharp.kernel.cubic })
                .png({ compressionLevel: PNG_COMPRESSION })
            await fs.writeFile(pngPath, resized)

            outputFiles.push(pngPath)

            fs.unlink(svgPath)
            console.log('Finished converting', file)
        }
    }

    console.log('Converting all SVG images to PNG...')

    const conversions = []

    for (const entry of entries) {
        const fullPath = path.join(outputPath, entry.name)

        if (entry.isDirectory()) {
            const svgFiles = await fs.readdir(fullPath)

            for (const file of svgFiles) {
                conversions.push(limit(() => convertSVGToPNG(file, fullPath)))
            }
        } else {
            conversions.push(limit(() => convertSVGToPNG(entry.name, entry.parentPath)))
        }
    }

    await Promise.all(conversions)

    if (!DONT_PACK) {
        console.log('Packing with TexturePacker...')

        const exportDir = OUTPUT_DIR ?? outputPath

        const jsonPath = path.join(exportDir, `${swfName}.json`)

        await runCommand(`TexturePacker --multipack --trim-sprite-names --format phaser --algorithm Basic --sheet "${path.join(exportDir, `${swfName}-{n}.png`)}" --data "${jsonPath}" ${outputPath}`)

        // Re-stringify the JSON to remove whitespace
        await fs.writeFile(jsonPath,
            JSON.stringify(JSON.parse(await fs.readFile(jsonPath)))
        )
    }

    if (!(DONT_PACK || SAVE_OUTPUT)) {
        outputFiles.forEach(_dir => fs.unlink(_dir))
    }

    await fs.rm(path.join(__dirname, tempDir), { recursive: true })

    console.log('Done')
} catch (e) {
    console.error(e)
}