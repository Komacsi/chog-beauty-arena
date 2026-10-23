// Consistent SQLite backup. Never overwrite an existing target.
import {DatabaseSync,backup} from 'node:sqlite';
import {open,chmod,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
const [sourceArg,targetArg,...rest]=process.argv.slice(2);
if(!sourceArg || !targetArg || rest.length)throw Error('Usage: node scripts/backup-sqlite.mjs SOURCE NEW_DESTINATION');
const source=resolve(sourceArg),target=resolve(targetArg);if(source===target)throw Error('Source and backup must differ');
// Reserve a private target exclusively; SQLite backup may open this empty file.
const reserved=await open(target,'wx',0o600);await reserved.close();let db;
try{db=new DatabaseSync(source,{readOnly:true});await backup(db,target);await chmod(target,0o600);console.log('Consistent SQLite backup saved.');}
catch(error){await unlink(target);throw error;}finally{db?.close();}
