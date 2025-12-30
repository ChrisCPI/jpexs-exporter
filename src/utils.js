import { exec } from 'child_process'
import fs from 'fs/promises'
import { parseString } from 'xml2js'

export async function runCommand(command) {
    return new Promise((resolve, reject) => {
        exec(command, (err, stdout, stder) => {
            if (err) {
                reject(err)
                return
            }
            resolve(stdout.trim())
        })
    })
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
    const xml = await fs.readFile(xmlPath, 'utf8')
    return new Promise((resolve, reject) => {
        parseString(xml, (err, result) => {
            if (err) {
                reject(err)
                return
            }
            resolve(result)
        })
    })
}