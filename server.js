const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Railway PostgreSQL 연결 설정
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

app.use(express.json());
app.use(express.static(__dirname));

// 데이터베이스 테이블 초기화 및 기본 데이터 적재
async function initDB() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS lotto_history (
                round INT PRIMARY KEY,
                nums JSONB NOT NULL,
                bonus INT NOT NULL,
                date VARCHAR(50)
            )
        `);

        // 테이블이 비어있다면 기본 데이터(최근 회차들) 삽입
        const res = await pool.query('SELECT COUNT(*) FROM lotto_history');
        if (parseInt(res.rows[0].count) === 0) {
            console.log("[DB 초기화] 기본 회차 데이터를 적재합니다...");
            const defaultData = [
                { round: 1239, nums: [11, 13, 22, 32, 33, 36], bonus: 8 },
                { round: 1238, nums: [2, 13, 18, 32, 38, 42], bonus: 22 },
                { round: 1237, nums: [10, 20, 23, 34, 37, 40], bonus: 36 },
                { round: 1236, nums: [12, 18, 21, 29, 34, 38], bonus: 10 },
                { round: 1235, nums: [6, 7, 11, 15, 39, 43], bonus: 20 },
                { round: 1234, nums: [1, 15, 19, 31, 35, 43], bonus: 27 },
                { round: 1233, nums: [2, 7, 20, 25, 37, 40], bonus: 29 },
                { round: 1232, nums: [12, 15, 19, 22, 24, 36], bonus: 3 },
                { round: 1231, nums: [4, 13, 14, 18, 31, 38], bonus: 15 },
                { round: 1230, nums: [3, 8, 9, 22, 28, 42], bonus: 45 },
                { round: 1229, nums: [12, 13, 29, 34, 37, 42], bonus: 16 },
                { round: 1228, nums: [24, 29, 30, 31, 35, 44], bonus: 1 },
                { round: 1227, nums: [1, 14, 16, 34, 41, 44], bonus: 13 },
                { round: 1226, nums: [4, 6, 13, 17, 26, 28], bonus: 41 },
                { round: 1225, nums: [8, 9, 19, 25, 41, 42], bonus: 33 },
                { round: 1224, nums: [9, 18, 21, 27, 44, 45], bonus: 28 },
                { round: 1223, nums: [16, 18, 20, 32, 33, 39], bonus: 26 },
                { round: 1222, nums: [4, 11, 17, 22, 32, 41], bonus: 34 },
                { round: 1221, nums: [6, 13, 18, 28, 30, 36], bonus: 9 },
                { round: 1220, nums: [2, 22, 25, 28, 34, 43], bonus: 16 }
            ];

            for (let item of defaultData) {
                await pool.query(
                    'INSERT INTO lotto_history (round, nums, bonus, date) VALUES ($1, $2, $3, $4) ON CONFLICT (round) DO NOTHING',
                    [item.round, JSON.stringify(item.nums), item.bonus, '']
                );
            }
        }
        console.log("[DB 연결 성공] 데이터베이스 준비 완료");
    } catch (err) {
        console.error("DB 초기화 실패:", err);
    }
}

// 동행복권 API 조회
async function fetchLottoRound(roundNo) {
    try {
        const url = `https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=${roundNo}`;
        const res = await axios.get(url);
        if (res.data && res.data.returnValue === 'success') {
            return {
                round: res.data.drwNo,
                nums: [
                    res.data.drwtNo1,
                    res.data.drwtNo2,
                    res.data.drwtNo3,
                    res.data.drwtNo4,
                    res.data.drwtNo5,
                    res.data.drwtNo6
                ].sort((a, b) => a - b),
                bonus: res.data.bnusNo,
                date: res.data.drwNoDate
            };
        }
    } catch (err) {
        console.error(`${roundNo}회차 조회 실패:`, err.message);
    }
    return null;
}

// 최신 회차 자동 업데이트
async function checkAndUpdateLatestLotto() {
    try {
        const res = await pool.query('SELECT MAX(round) as max_round FROM lotto_history');
        let latestSavedRound = res.rows[0].max_round || 1239;
        let targetRound = latestSavedRound + 1;

        console.log(`[자동 연구/업데이트] ${targetRound}회차 확인 중...`);
        let newData = await fetchLottoRound(targetRound);
        if (newData) {
            await pool.query(
                'INSERT INTO lotto_history (round, nums, bonus, date) VALUES ($1, $2, $3, $4) ON CONFLICT (round) DO NOTHING',
                [newData.round, JSON.stringify(newData.nums), newData.bonus, newData.date]
            );
            console.log(`🎉 [업데이트 성공] 제${targetRound}회차 당첨번호가 DB에 저장되었습니다!`);
            setTimeout(() => checkAndUpdateLatestLotto(), 2000);
        } else {
            console.log(`[대기 중] 제${targetRound}회차 추첨 결과 대기 중.`);
        }
    } catch (err) {
        console.error("자동 업데이트 중 에러 발생:", err);
    }
}

// API: 전체 로또 데이터 조회
app.get('/api/lotto', async (req, res) => {
    try {
        const result = await pool.query('SELECT round, nums, bonus, date FROM lotto_history ORDER BY round DESC');
        res.json(result.rows);
    } catch (err) {
        console.error("데이터 조회 실패:", err);
        res.status(500).json({ error: "Database error" });
    }
});

// API: 수동 회차 추가 또는 엑셀 일괄 업로드 저장 지원
app.post('/api/lotto', async (req, res) => {
    const { round, nums, bonus, date } = req.body;
    try {
        await pool.query(
            'INSERT INTO lotto_history (round, nums, bonus, date) VALUES ($1, $2, $3, $4) ON CONFLICT (round) DO UPDATE SET nums = EXCLUDED.nums, bonus = EXCLUDED.bonus',
            [round, JSON.stringify(nums), bonus, date || '']
        );
        res.json({ success: true });
    } catch (err) {
        console.error("데이터 저장 실패:", err);
        res.status(500).json({ error: "Database error" });
    }
});

// 매주 토요일 밤 자동 크론 (한국 시간 기준)
cron.schedule('45 20,21 * * 6', () => {
    checkAndUpdateLatestLotto();
}, {
    timezone: "Asia/Seoul"
});

app.listen(PORT, async () => {
    console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
    await initDB();
    await checkAndUpdateLatestLotto();
});
