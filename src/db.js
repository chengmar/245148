import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// 同一事务里的命令共用连接。MySQL 锁行令多个应用实例的写事务同样串行。
export async function openDB({ driver = process.env.DB_DRIVER || 'sqlite', filename = process.env.SQLITE_PATH || 'data/wareflow.db' } = {}) {
  let pool, sqlite;
  if (driver === 'mysql') {
    const mysql = await import('mysql2/promise');
    pool = mysql.createPool({host:process.env.MYSQL_HOST || '127.0.0.1',port:Number(process.env.MYSQL_PORT || 3306),user:process.env.MYSQL_USER || 'wareflow',password:process.env.MYSQL_PASSWORD || 'wareflow_lab_2026',database:process.env.MYSQL_DATABASE || 'wareflow',connectionLimit:8,decimalNumbers:true});
  } else {
    if(filename !== ':memory:') mkdirSync(dirname(filename),{recursive:true});
    sqlite = new DatabaseSync(filename);
    sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  }
  function adapter(conn) {
    return {
      async all(sql,params=[]) { return driver === 'mysql' ? (await conn.execute(sql,params))[0] : sqlite.prepare(sql).all(...params); },
      async get(sql,params=[]) {return (await this.all(sql,params))[0];},
      async run(sql,params=[]) {if(driver==='mysql'){const [r]=await conn.execute(sql,params);return {changes:r.affectedRows};}return sqlite.prepare(sql).run(...params);}
    };
  }
  const base=adapter(pool);
  const schema=readFileSync(new URL('./schema.sql',import.meta.url),'utf8');
  for(const sql of schema.split(';').map(s=>s.trim()).filter(Boolean)) await base.run(sql);
  if(!await base.get('SELECT id FROM system_lock WHERE id=1')) await base.run("INSERT INTO system_lock VALUES (1,'transaction mutex')");
  let tail=Promise.resolve();
  return {...base, driver,
    async tx(fn) {
      const previous=tail; let release;
      tail=new Promise(resolve=>release=resolve); await previous;
      let conn;
      try {
        conn=pool ? await pool.getConnection() : null;
        if(conn){await conn.beginTransaction();await conn.execute('SELECT id FROM system_lock WHERE id=1 FOR UPDATE');}
        else sqlite.exec('BEGIN IMMEDIATE');
        const result=await fn(adapter(conn));
        if(conn) await conn.commit();else sqlite.exec('COMMIT');
        return result;
      }catch(error){if(conn)await conn.rollback();else try{sqlite.exec('ROLLBACK');}catch{} throw error;}
      finally {conn?.release();release();}
    },
    async close(){await tail;if(pool)await pool.end();else sqlite.close();}
  };
}
