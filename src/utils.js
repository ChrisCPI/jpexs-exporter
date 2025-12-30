import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs/promises'
import { parseString } from 'xml2js'

const run = promisify(exec)
const parseXML = promisify(parseString)

export async function runCommand(command) {
   return (await run(command)).stdout.trim()
}

export async function ffdecCommand(command) {
    return await runCommand(`${process.env.FFDEC} ${command}`)
}

export async function directoryExists(path) {
    try {
        await fs.access(path)
        return true
    } catch (error) {
        if (error.code === 'ENOENT') {
            return false
        }
        throw error
    }
}

export async function parseXMLToJSON(xmlPath) {
    return await parseXML(await fs.readFile(xmlPath, 'utf8'))
}