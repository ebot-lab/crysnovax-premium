ALTER TABLE usage_daily ADD COLUMN source TEXT NOT NULL DEFAULT 'free';

INSERT OR IGNORE INTO commands VALUES ('ttsearch','media',1,0,5,40,120,30,datetime('now'));
INSERT OR IGNORE INTO commands VALUES ('lyrics','light',1,0,30,NULL,NULL,NULL,datetime('now'));
INSERT OR IGNORE INTO commands VALUES ('movie','light',1,0,20,NULL,NULL,NULL,datetime('now'));
INSERT OR IGNORE INTO commands VALUES ('livematch','light',1,0,20,NULL,NULL,NULL,datetime('now'));
INSERT OR IGNORE INTO commands VALUES ('tts','media',1,0,5,40,120,30,datetime('now'));
INSERT OR IGNORE INTO commands VALUES ('scan','heavy_ai',1,0,2,25,80,20,datetime('now'));
INSERT OR IGNORE INTO commands VALUES ('screenshot','media',1,0,5,40,120,30,datetime('now'));
INSERT OR IGNORE INTO commands VALUES ('weather','light',1,0,30,NULL,NULL,NULL,datetime('now'));
INSERT OR IGNORE INTO commands VALUES ('github','light',1,0,30,NULL,NULL,NULL,datetime('now'));
INSERT OR IGNORE INTO commands VALUES ('tggroup','light',1,0,20,NULL,NULL,NULL,datetime('now'));
INSERT OR IGNORE INTO commands VALUES ('tempemail','light',1,0,10,NULL,NULL,NULL,datetime('now'));
INSERT OR IGNORE INTO commands VALUES ('sketch','heavy_ai',1,0,2,25,80,20,datetime('now'));
INSERT OR IGNORE INTO commands VALUES ('tojif','media',1,0,5,40,120,30,datetime('now'));
INSERT OR IGNORE INTO commands VALUES ('qrread','light',1,0,20,NULL,NULL,NULL,datetime('now'));
