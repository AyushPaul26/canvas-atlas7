import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,existsSync} from 'node:fs';
import {dirname} from 'node:path';

export const DATABASE_VERSION=2;
let savepointCounter=0;
export function checkDatabaseVersion(db:DatabaseSync):void {
  const {user_version:version}=db.prepare('PRAGMA user_version').get() as {user_version:number};
  if(version>DATABASE_VERSION)throw new Error('Lesson data uses a newer schema.');
  if(version!==DATABASE_VERSION)throw new Error('Lesson data requires a schema migration.');
}
export function databaseTransaction<T>(db:DatabaseSync,work:()=>T):T {
  checkDatabaseVersion(db);
  const nested=db.isTransaction,savepoint=`atlas_${++savepointCounter}`;
  db.exec(nested?`SAVEPOINT ${savepoint}`:'BEGIN IMMEDIATE');
  try{const result=work();db.exec(nested?`RELEASE ${savepoint}`:'COMMIT');return result;}
  catch(error){db.exec(nested?`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`:'ROLLBACK');throw error;}
}
export function openDatabase(path:string):DatabaseSync {
  if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});
  const db=new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  let version=(db.prepare('PRAGMA user_version').get() as {user_version:number}).user_version;
  const migratingVersionOne=version===1;
  if(version>DATABASE_VERSION){db.close();throw new Error('This lesson database uses a newer version. Update Canvas Atlas to open it.');}
  try {
  if(version===0){
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE sessions(id TEXT PRIMARY KEY,topic TEXT NOT NULL,title TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,snapshot TEXT NOT NULL,event_seq INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE events(session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,seq INTEGER NOT NULL,created_at TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(session_id,seq));
      CREATE TABLE scene_snapshots(session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,revision INTEGER NOT NULL DEFAULT 0,payload TEXT NOT NULL);
      CREATE TABLE program_versions(session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,hash TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(session_id,hash));
      CREATE TABLE playback_checkpoints(session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,payload TEXT NOT NULL);
      CREATE TABLE learner_evidence(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,observed TEXT NOT NULL,inference TEXT,created_at TEXT NOT NULL);
      CREATE TABLE preferences(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      PRAGMA user_version=1; COMMIT;`);
    version=1;
  }
  if(version===1){
    // VACUUM INTO includes committed WAL pages and creates a consistent backup.
    // Keep the first v1 backup intact across retries; never open/migrate it here.
    if(migratingVersionOne&&path!==':memory:'&&!existsSync(`${path}.v1.bak`))db.prepare('VACUUM main INTO ?').run(`${path}.v1.bak`);
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE documents(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
      CREATE TABLE document_sections(document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,extraction_version INTEGER NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(document_id,extraction_version,id));
      CREATE TABLE document_assets(document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,id TEXT NOT NULL,path TEXT NOT NULL,mime_type TEXT NOT NULL,byte_size INTEGER NOT NULL,PRIMARY KEY(document_id,id));
      CREATE TABLE learning_plans(id TEXT NOT NULL,version INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(id,version));
      CREATE TABLE session_plans(session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,plan_id TEXT NOT NULL,plan_version INTEGER NOT NULL,FOREIGN KEY(plan_id,plan_version) REFERENCES learning_plans(id,version));
      CREATE TABLE courses(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
      CREATE TABLE course_sessions(course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,PRIMARY KEY(course_id,session_id));
      CREATE TABLE concept_progress(session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,payload TEXT NOT NULL);
      CREATE TABLE accepted_beats(session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,beat_id TEXT NOT NULL,payload TEXT NOT NULL,baseline TEXT NOT NULL,PRIMARY KEY(session_id,beat_id));
      PRAGMA user_version=2; COMMIT;`);
  }
  if(path!==':memory:')db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
  return db;
  }catch(error){if(db.isTransaction)db.exec('ROLLBACK');db.close();throw error;}
}
