const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'lotto_data.json');

app.use(express.json());
app.use(express.static(__dirname));

let lottoData = [];

function loadData() {
    if (fs.existsSync(DATA_FILE)) {
        try {
            lottoData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            console.log(`[데이터 로드] 총 ${lottoData.length}개 회차 로드 완료`);
        } catch (e) {
            console.error("데이터 파일 읽기 실패:", e);
        }
    }
}

function saveData() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(lottoData, null, 2), 'utf8');
}

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

async function checkAndUpdateLatestLotto() {
    if (lottoData.length === 0) loadData();
    let latestSavedRound = lottoData.length > 0 ? Math.max(...lottoData.map(d => d.round)) : 1239;
    let targetRound = latestSavedRound + 1;

    console.log(`[자동 연구/업데이트] ${targetRound}회차 확인 중...`);
    let newData = await fetchLottoRound(targetRound);
    if (newData) {
        lottoData.unshift(newData);
        lottoData.sort((a, b) => b.round - a.round);
        saveData();
        console.log(`🎉 [업데이트 성공] 제${targetRound}회차 당첨번호 추가됨!`);
        setTimeout(() => checkAndUpdateLatestLotto(), 2000);
    } else {
        console.log(`[대기 중] 제${targetRound}회차 추첨 결과 대기 중.`);
    }
}

app.get('/api/lotto', (req, res) => {
    if (lottoData.length === 0) loadData();
    res.json(lottoData.length > 0 ? lottoData : [
        { round: 1239, nums: [11, 13, 22, 32, 33, 36], bonus: 8 }
    ]);
});

cron.schedule('30 21,22 * * 6', () => {
    checkAndUpdateLatestLotto();
});

app.listen(PORT, async () => {
    console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
    loadData();
    await checkAndUpdateLatestLotto();
});
