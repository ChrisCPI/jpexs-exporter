import { exec } from 'child_process'
import fs from 'fs/promises'

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