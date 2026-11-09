# 오송 시나리오에 지도 좌표·소개문을 넣고, 미호천교 실측 수위(있으면)를 넣는다. 사용: python3 scripts/patch-osong.py [hrfco_0715.json]
import json, sys, pathlib
p = pathlib.Path(__file__).resolve().parent.parent / 'scenarios' / 'osong-20230715-record.json'
o = json.load(open(p))
coord = {'P1': [36.6231, 127.3511], 'P2': [36.6227, 127.3453], 'P3': [36.6287, 127.3244]}
for pl in o['places']:
    pl['coord'] = coord[pl['id']]
o['gauges'][0]['coord'] = coord['P1']
o['facilities'][0]['coord'] = coord['P2']
o['facilities'][0]['short'] = '궁평2지하차도'
o['basis'] = 'record'
o['title'] = '2023년 7월 15일 오송 (공식 기록 기반 재구성)'
o['intro'] = '2023년 7월 15일 새벽, 오송 궁평2지하차도 주변의 위험 신호는 여러 기관에 흩어져 들어왔습니다. 공식 기록으로 시각을 확인한 신호를 한 당직 화면에 모았다고 가정하면 언제 어떤 권고가 나오는지 재생합니다. 임시제방 붕괴 이후 장면은 넣지 않았습니다.'
o['sources'] = ['국무조정실 감찰 조사결과 브리핑(2023.7.28)', '연합뉴스', '문화일보', '서울신문', '시민진상조사위원회·MBC 보도']
if len(sys.argv) > 1:
    raw = json.load(open(sys.argv[1]))
    st = next((x for x in raw['stations'] if ('미호강교' in x['info']['obsnm'] or '미호천교' in x['info']['obsnm']) and x['rows']), None)
    if st:
        g = o['gauges'][0]
        i = st['info']
        num = lambda k: float(i[k]) if str(i.get(k, '')).strip() else None
        g['chart_levels'] = {k: v for k, v in {'관심': num('attwl'), '주의': num('wrnwl'), '경계': num('almwl'), '심각': num('srswl')}.items() if v}
        g['source'] = '2023-07-15 한강홍수통제소 10분 실측(수위표 기준). 기준선은 현재 관측소 기준이고, 신호의 29.02m는 표고 기준'
        series = []
        for r in sorted(st['rows'], key=lambda r: r['ymdhm']):
            if str(r['wl']).strip() and r['ymdhm'][:8] == '20230715':
                t = f"{r['ymdhm'][8:10]}:{r['ymdhm'][10:12]}"
                if o['clock']['start'] <= t <= o['clock']['end']:
                    series.append([t, round(float(r['wl']), 2)])
        o['timeseries'] = {'G1': series}
        print('미호천교 시계열', len(series), series[:2], series[-2:])
json.dump(o, open(p, 'w'), ensure_ascii=False, indent=1)
print('저장', p)
