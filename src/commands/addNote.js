// @ts-check
import '../commands/typedefs.js'

import { GitRefManager } from '../managers/GitRefManager.js'
import { FileSystem } from '../models/FileSystem.js'
import { E, GitError } from '../models/GitError.js'
import { join } from '../utils/join'

import { commit } from './commit.js'
import { readTree } from './readTree.js'
import { writeBlob } from './writeBlob.js'
import { writeTree } from './writeTree.js'

/**
 * Add or update an object note
 *
 * @param {object} args
 * @param {FsClient} args.fs - a file system implementation
 * @param {SignCallback} [args.sign] - a PGP signing implementation
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir,'.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string} [args.ref] - The notes ref to look under
 * @param {string} args.oid - The SHA-1 object id of the object to add the note to.
 * @param {string|Uint8Array} args.note - The note to add
 * @param {boolean} [args.force] - Over-write note if it already exists.
 * @param {Object} [args.author] - The details about the author.
 * @param {string} [args.author.name] - Default is `user.name` config.
 * @param {string} [args.author.email] - Default is `user.email` config.
 * @param {Date} [args.author.date] - Set the author timestamp field. Default is the current date.
 * @param {number} [args.author.timestamp] - Set the author timestamp field. This is an alternative to using `date` using an integer number of seconds since the Unix epoch instead of a JavaScript date object.
 * @param {number} [args.author.timezoneOffset] - Set the author timezone offset field. This is the difference, in minutes, from the current timezone to UTC. Default is `(new Date()).getTimezoneOffset()`.
 * @param {Object} [args.committer = author] - The details about the note committer, in the same format as the author parameter. If not specified, the author details are used.
 * @param {string} [args.committer.name] - Default is `user.name` config.
 * @param {string} [args.committer.email] - Default is `user.email` config.
 * @param {Date} [args.committer.date] - Set the committer timestamp field. Default is the current date.
 * @param {number} [args.committer.timestamp] - Set the committer timestamp field. This is an alternative to using `date` using an integer number of seconds since the Unix epoch instead of a JavaScript date object.
 * @param {number} [args.committer.timezoneOffset] - Set the committer timezone offset field. This is the difference, in minutes, from the current timezone to UTC. Default is `(new Date()).getTimezoneOffset()`.
 * @param {string} [args.signingKey] - Sign the note commit using this private PGP key.
 *
 * @returns {Promise<string>} Resolves successfully with the SHA-1 object id of the commit object for the added note.
 */

export async function addNote ({
  fs: _fs,
  sign,
  dir,
  gitdir = join(dir, '.git'),
  ref = 'refs/notes/commits',
  oid,
  note,
  force,
  author,
  committer,
  signingKey
}) {
  try {
    const fs = new FileSystem(_fs)

    // Get the current note commit
    let parent
    try {
      parent = await GitRefManager.resolve({ gitdir, fs, ref })
    } catch (err) {
      if (err.code !== E.ResolveRefError) {
        throw err
      }
    }

    // I'm using the "empty tree" magic number here for brevity
    const result = await readTree({
      fs: _fs,
      dir,
      gitdir,
      oid: parent || '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
    })
    let tree = result.tree

    // Handle the case where a note already exists
    if (force) {
      tree = tree.filter(entry => entry.path !== oid)
    } else {
      for (const entry of tree) {
        if (entry.path === oid) {
          throw new GitError(E.NoteAlreadyExistsError, {
            note: entry.oid,
            oid
          })
        }
      }
    }

    // Create the note blob
    if (typeof note === 'string') {
      note = Buffer.from(note, 'utf8')
    }
    const noteOid = await writeBlob({
      fs: _fs,
      dir,
      gitdir,
      blob: note
    })

    // Create the new note tree
    tree.push({ mode: '100644', path: oid, oid: noteOid, type: 'blob' })
    const treeOid = await writeTree({
      fs: _fs,
      dir,
      gitdir,
      tree
    })

    // Create the new note commit
    const commitOid = await commit({
      fs: _fs,
      sign,
      dir,
      gitdir,
      ref,
      tree: treeOid,
      parent: parent && [parent],
      message: `Note added by 'isomorphic-git addNote'\n`,
      author,
      committer,
      signingKey
    })

    return commitOid
  } catch (err) {
    err.caller = 'git.addNote'
    throw err
  }
}
