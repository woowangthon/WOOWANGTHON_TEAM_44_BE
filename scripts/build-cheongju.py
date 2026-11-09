# 청주 2026-07-09 새벽 시나리오 JSON 생성기 (보도 기반 재구성)
# 사용: python3 scripts/build-cheongju.py [hrfco_0709.json]
# 흥덕교 실측 수위(한강홍수통제소 10분 자료)가 있으면 수위 시계열·관측소 기준·좌표·수위 알림 신호를 채운다.
import json, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = {
    'fn0949': '파이낸셜뉴스 2026.7.9 09:49(뉴시스)',
    'nw0706': '뉴시스 2026.7.9 07:06',
    'nw1028': '뉴시스 2026.7.9 10:28',
    'nw1114': '뉴시스 2026.7.9 11:14',
    'yn0917': '연합뉴스 2026.7.9(파이낸셜뉴스 09:17 게재)',
    'ytn0837': 'YTN 2026.7.9 08:37',
    'ytn0941': 'YTN 2026.7.9 09:41',
    'sg0709': '세계일보 2026.7.9',
    'in1351': '아이뉴스24 2026.7.9 13:51',
}

places = [
    {'id': 'P1', 'name': '무심천', 'aliases': ['흥덕교', '무심천 하상도로', '하상도로', '무심천변', '둔치주차장', '청주대교'], 'coord': [36.6405, 127.4836]},
    {'id': 'P2', 'name': '미평천', 'aliases': ['장성2교', '미평동', '장성동', '미평천변'], 'coord': [36.5990, 127.4740]},
    {'id': 'P3', 'name': '낭성면', 'aliases': ['낭성'], 'coord': [36.62878, 127.6006]},
    {'id': 'P4', 'name': '가덕면', 'aliases': ['가덕'], 'coord': [36.55788, 127.56114]},
    {'id': 'P5', 'name': '가경동', 'aliases': [], 'coord': [36.62007, 127.43415]},
    {'id': 'P6', 'name': '비하동', 'aliases': ['서청주사거리'], 'coord': [36.63293, 127.41774]},
    {'id': 'P7', 'name': '운천동', 'aliases': ['운천초', '운천초등학교'], 'coord': [36.65427, 127.47352]},
    {'id': 'P8', 'name': '수석천', 'aliases': ['석화리', '강내면'], 'coord': [36.62352, 127.38192]},
    {'id': 'P9', 'name': '사창동', 'aliases': [], 'coord': [36.63404, 127.46342]},
    {'id': 'P10', 'name': '문암철교 하부도로', 'aliases': ['문암철교', '문암동'], 'coord': [36.67233, 127.45115]},
]
# 지명 사전: 직접 입력한 메모도 지도에 찍히도록 청주 시내 동·읍 일부를 더한다(좌표: OpenStreetMap Nominatim)
EXTRA = {
    '복대동': [36.63605, 127.44059], '봉명동': [36.64716, 127.45854], '수곡동': [36.61769, 127.48358], '모충동': [36.62512, 127.48079],
    '향정동': [36.64807, 127.42774], '사직동': [36.63641, 127.48371], '중앙동': [36.63985, 127.4882], '성안동': [36.63162, 127.4932],
    '탑동': [36.62985, 127.4986], '대성동': [36.63447, 127.49704], '영운동': [36.61922, 127.50045], '금천동': [36.62673, 127.5051],
    '용담동': [36.63665, 127.50783], '명암동': [36.65239, 127.52276], '산성동': [36.65678, 127.54327], '용암동': [36.61393, 127.51276],
    '오송읍': [36.62874, 127.32436], '청주시청': [36.64246, 127.48904],
}
for i, (n, c) in enumerate(EXTRA.items()):
    places.append({'id': f'P{11 + i}', 'name': n, 'aliases': [], 'coord': c, 'dictionary_only': True})

gauges = [
    {'id': 'G1', 'name': '흥덕교', 'place_id': 'P1', 'unit': 'm', 'levels': {}, 'source': '금강 수계, 한강홍수통제소 수위 자료'},
    {'id': 'G2', 'name': '장성2교', 'place_id': 'P2', 'unit': 'm', 'levels': {'심각': 3.1}},
]

facilities = [
    {'id': 'F1', 'name': '무심천 하상도로·둔치주차장', 'short': '하상도로', 'type': 'riverside_road', 'place_ids': ['P1'], 'gauge': 'G1', 'manager_contact': 'K3', 'coord': [36.6372, 127.4840],
     'criteria': [
         {'id': 'C1', 'kind': 'river_alert', 'gauge': 'G1', 'level': '주의', 'near_level': None, 'clause': 'M3-1-1', 'label': '흥덕교 홍수특보 또는 주의 수위 도달'},
         {'id': 'C2', 'kind': 'fact_report', 'fact_types': ['road_water', 'levee_concern'], 'place_ids': ['P1'], 'clause': 'M3-1-2', 'label': '하상도로·둔치 침수 신고', 'threshold_label': '물 차오름·넘침 신고 접수'},
     ]},
    {'id': 'F2', 'name': '미평천 장성2교 일원 하천변', 'short': '장성2교', 'type': 'riverside_road', 'place_ids': ['P2'], 'gauge': 'G2', 'manager_contact': 'K4', 'coord': [36.5967, 127.4762],
     'criteria': [
         {'id': 'C3', 'kind': 'river_alert', 'gauge': 'G2', 'level': '심각', 'near_level': '경계', 'clause': 'M3-1-1', 'label': '장성2교 홍수특보 또는 심각 수위 도달'},
         {'id': 'C4', 'kind': 'fact_report', 'fact_types': ['road_water', 'levee_concern'], 'place_ids': ['P2'], 'clause': 'M3-1-2', 'label': '하천변 도로 침수 신고', 'threshold_label': '물 차오름·넘침 신고 접수'},
     ]},
    {'id': 'F3', 'name': '문암철교 하부도로', 'short': '문암철교', 'type': 'underpass', 'place_ids': ['P10'], 'manager_contact': 'K6', 'coord': [36.6745, 127.4500],
     'criteria': [
         {'id': 'C5', 'kind': 'fact_report', 'fact_types': ['road_water', 'road_blocked', 'closure_request'], 'place_ids': ['P10'], 'clause': 'M4', 'label': '하부도로 노면 침수 신고', 'threshold_label': '노면 침수·통행 곤란 신고 접수'},
     ]},
]

contacts = [
    {'id': 'K1', 'org': '청주시 당직사령', 'role': '당직 책임자'},
    {'id': 'K2', 'org': '청주시 재난안전대책본부 상황실', 'role': '재난 총괄'},
    {'id': 'K3', 'org': '청주시 하상도로 관리 부서 야간 비상연락', 'role': '무심천 하상도로·둔치주차장 통제'},
    {'id': 'K4', 'org': '서원구청 당직실', 'role': '미평동·장성동 관할'},
    {'id': 'K5', 'org': '상당구청 당직실', 'role': '낭성면·가덕면 관할'},
    {'id': 'K6', 'org': '흥덕구청 당직실', 'role': '가경동·비하동·운천동·강내면·문암동 관할'},
    {'id': 'K7', 'org': '청주흥덕경찰서 상황실', 'role': '교통 통제 협조'},
    {'id': 'K8', 'org': '충북소방본부 119종합상황실', 'role': '현장 확인·구조'},
    {'id': 'K9', 'org': '청주시 하수 담당 부서 야간 비상연락', 'role': '빗물받이·하수 역류'},
    {'id': 'K10', 'org': '충청북도교육청 당직실', 'role': '학교 시설 피해'},
]

manual = {
    'title': '청주시 풍수해 당직 매뉴얼(데모용, 공개 기준을 참고해 작성)',
    'clauses': [
        {'id': 'M3-1', 'heading': '제3조(하천변 도로·둔치 통제) 제1항', 'text': '하상도로, 둔치주차장, 하천 산책로를 관리하는 부서는 다음 각 호의 어느 하나에 해당하는 경우 차량과 사람의 출입을 통제한다.'},
        {'id': 'M3-1-1', 'heading': '제3조 제1항 제1호', 'text': '해당 하천 수위관측소에 홍수주의보 이상의 홍수특보가 발령되거나 관측 수위가 기준 수위에 도달한 경우'},
        {'id': 'M3-1-2', 'heading': '제3조 제1항 제2호', 'text': '하상도로나 둔치, 하천변 도로에 물이 차오르거나 넘친다는 신고가 접수된 경우'},
        {'id': 'M3-2', 'heading': '제3조 제2항', 'text': '당직자는 제1항 각 호의 상황을 인지한 경우 관리 부서에 통제 검토를 요청하고 당직사령에게 보고한다. 둔치주차장에 차량이 남아 있으면 차주 연락과 이동 안내를 함께 요청한다.'},
        {'id': 'M4', 'heading': '제4조(지하차도·하부도로)', 'text': '지하차도와 철도 하부도로는 노면 침수심이 5센티미터 이상이면 진입을 통제한다. 당직자는 침수 신고를 받으면 관리 부서와 관할 경찰서에 통제 검토를 요청하고 당직사령에게 보고한다.'},
        {'id': 'M5', 'heading': '제5조(토사·축대·산사태)', 'text': '토사 유출, 축대 붕괴, 산사태 신고가 접수되면 당직자는 관할 구청과 소방 상황실에 현장 확인을 요청하고 당직사령에게 보고한다. 요양시설 등 재난약자 이용시설이거나 대피가 진행 중이면 재난안전대책본부에도 지체 없이 보고한다.'},
        {'id': 'M6', 'heading': '제6조(특보 보고)', 'text': '당직자는 호우경보 또는 홍수주의보 이상의 홍수특보 통보를 받은 경우 당직사령과 재난안전대책본부에 보고한다.'},
        {'id': 'M7', 'heading': '제7조(생활 불편 신고)', 'text': '빗물받이 막힘, 도로 물 고임, 정전 등 생활 불편 신고는 담당 부서나 관할 구청에 전달한다. 인명 위험이 있거나 통행이 막힌 경우에는 당직사령에게 보고한다.'},
        {'id': 'M8', 'heading': '제8조(하천 넘침 우려)', 'text': '하천 물이 제방 가까이 차오르거나 넘칠 우려가 있다는 신고를 받으면 당직자는 관할 구청에 현장 확인을 요청하고 당직사령에게 보고한다. 범람이 확인되면 주민 대피 안내가 필요한지 재난안전대책본부에 보고한다.'},
        {'id': 'M9', 'heading': '제9조(다른 기관 시설)', 'text': '학교 등 다른 기관이 관리하는 시설의 피해 신고는 해당 기관 당직실에 전달하고 기록한다.'},
        {'id': 'M10', 'heading': '제10조(기록)', 'text': '당직자는 보고, 요청, 보류의 내용과 사유, 시각을 당직일지에 기록한다.'},
    ],
}

def rec(src, note=None):
    r = {'basis': 'record', 'source': SRC[src]}
    if note: r['note'] = note
    return r

ADDED = {'basis': 'added', 'note': '시연을 위해 더한 가상 신호(실제 기록 아님)'}

signals = [
    {'id': 'C01', 't': '05:10', 'channel': 'system_alert', 'from': '기상특보(연동)', 'body': '[기상특보] 청주 호우경보 발효(05:10). 강한 비가 이어지고 있어 하천변, 지하차도, 산사태 위험 지역 접근에 유의.',
     'data': {'type': 'weather_warning', 'area': '청주', 'level': '호우경보'}, 'record': rec('fn0949')},
    {'id': 'C02', 't': '05:16', 'channel': 'phone_memo', 'from': '사창동 주민', 'body': '집 앞 빗물받이가 막혀서 물이 안 빠지고 도로 가장자리에 물이 고였다고 함. 차가 지나갈 때마다 물이 튄다고 함.', 'record': ADDED},
    {'id': 'C03', 't': '05:22', 'channel': 'fire_119', 'from': '충북소방 119종합상황실', 'body': '[119 공동대응] 상당구 낭성면 주택에 낙뢰, 정전 신고(05:20경). 인명 피해 없음, 한전에 통보함.',
     'record': rec('nw0706'), 'time_note': '낙뢰 시각은 05:20(뉴시스 07:06)과 05:24(뉴시스 10:28)로 보도가 다름'},
    {'id': 'C04', 't': '05:47', 'channel': 'fire_119', 'from': '충북소방 119종합상황실', 'body': '[119 공동대응] 서원구 미평동 도로 침수 신고 접수(05:47). 배수 지원 출동.', 'record': rec('sg0709')},
    {'id': 'C05', 't': '06:00', 'channel': 'system_alert', 'from': '수위 알림(연동)', 'body': '장성2교 수위관측소 3.54m, 심각 기준(3.1m) 초과',
     'data': {'type': 'gauge', 'gauge': 'G2', 'level_m': 3.54}, 'record': rec('yn0917', '06시께 3.54m, 심각 기준 3.1m 초과 후 하강')},
    {'id': 'C06', 't': '06:02', 'channel': 'agency_notice', 'from': '금강홍수통제소', 'body': '[홍수주의보 발령] 무심천 흥덕교 지점에 홍수주의보를 발령합니다. 하천 주변 안전에 각별히 유의하시기 바랍니다.',
     'record': rec('ytn0941'), 'time_note': '보도는 「06시 전후」. 시연에서는 06:02로 둠'},
    {'id': 'C07', 't': '06:20', 'channel': 'police_112', 'from': '청주흥덕경찰서 상황실', 'body': '[112 공조] 순찰차 보고: 무심천 둔치주차장에 차량 몇 대가 아직 주차돼 있음. 차주 연락과 이동 안내가 필요하다고 함.', 'record': ADDED},
    {'id': 'C08', 't': '06:16', 'channel': 'fire_119', 'from': '충북소방 119종합상황실', 'body': '[119 공동대응] 상당구 낭성면 주택 뒤편 야산에서 토사가 흘러내린다는 신고(06:16). 현장 출동.', 'record': rec('sg0709')},
    {'id': 'C09', 't': '06:31', 'channel': 'phone_memo', 'from': '시민(번호 미표시)', 'body': '비 때문에 오늘 아침 시내버스가 정상 운행하는지 묻는 전화. 어느 정류장인지는 말하지 않음.', 'record': ADDED},
    {'id': 'C10', 't': '06:40', 'channel': 'fire_119', 'from': '충북소방 119종합상황실', 'body': '[119 공동대응] 상당구 가덕면 요양원 뒤편 축대 붕괴 신고(06:40). 입소자와 직원 12명을 인근 복지시설로 대피시키는 중.', 'record': rec('nw1114')},
    {'id': 'C11', 't': '07:20', 'channel': 'phone_memo', 'from': '가경동 아파트 주민', 'body': '가경동 아파트 단지 안 도로에 물이 차서 주차된 차 5~6대가 반쯤 잠겼다고 함. 차에 사람은 없다고 함.', 'record': rec('ytn0837', '제보 시각 07:20쯤')},
    {'id': 'C12', 't': '07:30', 'channel': 'phone_memo', 'from': '비하동 주민', 'body': '서청주사거리 근처 하천 물이 제방 끝까지 차올랐다는 전화. 이대로면 넘칠 것 같다고 함.', 'record': rec('ytn0837', '제보 시각 07:30쯤')},
    {'id': 'C13', 't': '07:45', 'channel': 'police_112', 'from': '청주흥덕경찰서 상황실', 'body': '[112 공조] 문암동 문암철교 하부도로에 물이 차 차량이 지나가기 어렵다는 신고. 순찰차가 현장 확인 중이며 통제 권한이 있는 기관을 묻고 있음.',
     'record': rec('yn0917'), 'time_note': '보도에는 09:17 이전에 통제됐다는 사실만 있고 신고 시각은 없음. 시연에서는 07:45로 둠'},
    {'id': 'C14', 't': '08:00', 'channel': 'phone_memo', 'from': '운천동 주민', 'body': '운천동 초등학교 운동장이 물에 잠겼다는 전화. 학교 건물 안으로는 아직 안 들어갔다고 함.', 'record': rec('ytn0941', '08:00쯤')},
    {'id': 'C15', 't': '08:25', 'channel': 'fire_119', 'from': '충북소방 119종합상황실', 'body': '[119 공동대응] 흥덕구 강내면 석화리 수석천 일부 범람, 주변 도로 침수 신고(08:25). 인근 주민 대피 안내가 필요하다고 함.', 'record': rec('yn0917')},
    {'id': 'C16', 't': '08:29', 'channel': 'disaster_sms', 'from': '청주시 재난문자', 'body': '[청주시] 강내면 수석천 범람 우려. 인근 주민은 안전한 곳으로 대피하고 하천에 접근하지 마시기 바랍니다.',
     'record': rec('yn0917', '범람 직후 대피 안내·하천 접근 금지 문자를 보냈다는 보도의 요지. 실제 문자 원문 아님')},
]

expected = {
    'incidents': [
        {'id': 'E_mipyeong', 'facility': 'F2', 'signals': ['C04', 'C05']},
        {'id': 'E_musim', 'facility': 'F1', 'signals': ['C06', 'C07']},
        {'id': 'E_nangseong', 'signals': ['C03', 'C08']},
        {'id': 'E_sachang', 'signals': ['C02']},
        {'id': 'E_gadeok', 'signals': ['C10']},
        {'id': 'E_gagyeong', 'signals': ['C11']},
        {'id': 'E_biha', 'signals': ['C12']},
        {'id': 'E_munam', 'facility': 'F3', 'signals': ['C13']},
        {'id': 'E_uncheon', 'signals': ['C14']},
        {'id': 'E_suseok', 'signals': ['C15', 'C16']},
    ],
    'background': ['C01', 'C09'],
    'min_grade_by': [
        {'incident': 'E_mipyeong', 'grade': 'control_review', 'not_later_than': 'C05'},
        {'incident': 'E_musim', 'grade': 'control_review', 'not_later_than': 'C06'},
        {'incident': 'E_nangseong', 'grade': 'report', 'not_later_than': 'C08'},
        {'incident': 'E_gadeok', 'grade': 'report', 'not_later_than': 'C10'},
        {'incident': 'E_biha', 'grade': 'report', 'not_later_than': 'C12'},
        {'incident': 'E_munam', 'grade': 'control_review', 'not_later_than': 'C13'},
        {'incident': 'E_suseok', 'grade': 'report', 'not_later_than': 'C15'},
    ],
    'demo_decisions': [
        {'after': 'C05', 'incident_of': 'C05', 'action': 'control_review', 'recipients': ['K4', 'K1'], 'reason': '장성2교 수위가 심각 기준을 넘고 미평동 도로 침수 신고가 있어 서원구에 하천변 통제 검토를 요청하고 당직사령에게 보고함.'},
        {'after': 'C06', 'incident_of': 'C06', 'action': 'hold', 'recipients': [], 'reason': '하상도로에 아직 물이 찼다는 신고가 없어 흥덕교 수위 추이를 보고 판단하기로 함.'},
        {'after': 'H03', 'incident_of': 'H03', 'action': 'control_review', 'recipients': ['K3', 'K7', 'K1'], 'reason': '흥덕교 수위가 주의 수위를 넘고 둔치주차장에 차량이 남아 있다는 보고가 있어 하상도로·둔치주차장 통제와 차주 연락을 요청함.'},
        {'after': 'C10', 'incident_of': 'C10', 'action': 'report', 'recipients': ['K5', 'K8', 'K1', 'K2'], 'reason': '요양원 축대 붕괴로 12명이 대피 중이라 상당구청과 소방에 확인을 요청하고 재난안전대책본부에 보고함.'},
        {'after': 'C13', 'incident_of': 'C13', 'action': 'control_review', 'recipients': ['K6', 'K7', 'K1'], 'reason': '문암철교 하부도로 침수로 통행이 어렵다는 경찰 신고를 받아 흥덕구청과 경찰에 통제 검토를 요청함.'},
        {'after': 'C16', 'incident_of': 'C15', 'action': 'report', 'recipients': ['K6', 'K2', 'K1'], 'reason': '수석천 범람으로 주민 대피 안내가 필요해 흥덕구청에 현장 확인을 요청하고 재난안전대책본부에 보고함.'},
    ],
}

scn = {
    'id': 'cheongju-20260709',
    'title': '2026년 7월 9일 새벽 청주 (보도 기반 재구성)',
    'synthetic': True,
    'basis': 'record',
    'disclaimer': '2026년 7월 9일 새벽 청주의 호우 상황을 보도로 확인한 시각·장소를 바탕으로 재구성했습니다. 신호 문장은 실제 신고·통보 원문이 아니며, 「가상 추가」 표시가 붙은 일상 민원은 시연을 위해 더한 것입니다. 매뉴얼과 연락처는 데모용이고, 당시 기관의 대응을 평가하려는 것이 아닙니다.',
    'intro': '2026년 7월 9일 새벽 청주에는 0시부터 8시까지 133mm의 비가 내렸고, 인명 피해 없이 지나간 이 밤에도 시에만 53건의 신고가 들어왔습니다(뉴시스). 보도로 확인한 그날의 신호를 시청 당직실 한 자리로 모았다고 가정해 재생합니다.',
    'sources': list(SRC.values()),
    'duty': {'office': '청주시청 당직실(재구성)', 'officer_role': '당직원(행정직, 순환 근무)'},
    'clock': {'date': '2026-07-09', 'tz': '+09:00', 'start': '05:00', 'end': '08:40'},
    'places': places, 'gauges': gauges, 'timeseries': {}, 'facilities': facilities, 'contacts': contacts, 'manual': manual,
    'signals': signals, 'expected': expected,
}

# ---- 실측 수위 (한강홍수통제소 10분 자료) ----
def dms(v):
    s = str(v).strip()
    if '-' in s:
        d, m, sec = (float(x) for x in s.split('-'))
        return round(d + m / 60 + sec / 3600, 5)
    return round(float(s), 5)

PICKS = {'G1': ['06:30', '07:40', '08:20'], 'G2': ['07:00']}
EXP_INC = {'G1': 'E_musim', 'G2': 'E_mipyeong'}
if len(sys.argv) > 1:
    raw = json.load(open(sys.argv[1]))
    for g in gauges:
        st = next((x for x in raw['stations'] if g['name'] in x['info']['obsnm'] and x['rows']), None)
        if not st:
            continue
        info = st['info']
        num = lambda k: (float(info[k]) if str(info.get(k, '')).strip() else None)
        g['levels'] = {k: v for k, v in {'관심': num('attwl'), '주의': num('wrnwl'), '경계': num('almwl'), '심각': num('srswl')}.items() if v}
        g['code'] = info['wlobscd']
        g['source'] = '한강홍수통제소 수위 Open API 10분 자료(실측)'
        g['coord'] = [dms(info['lat']), dms(info['lon'])]
        series = []
        for r in sorted(st['rows'], key=lambda r: r['ymdhm']):
            if not str(r['wl']).strip() or r['ymdhm'][:8] != '20260709':
                continue
            t = f"{r['ymdhm'][8:10]}:{r['ymdhm'][10:12]}"
            if '05:00' <= t <= '08:40':
                series.append([t, round(float(r['wl']), 2)])
        scn['timeseries'][g['id']] = series
        lv_sorted = sorted(g['levels'].items(), key=lambda kv: kv[1])
        picks = set(PICKS[g['id']])
        top = -1
        for t, v in series:  # 기준 수위를 처음 넘어설 때(오를 때만) 알림
            n = len([k for k, x in lv_sorted if v >= x])
            if n > top and n > 0:
                picks.add(t)
                top = n
        val = dict(series)
        for i, t in enumerate(sorted(x for x in picks if x in val)):
            v = val[t]
            over = [k for k, x in lv_sorted if v >= x]
            sid = f"{'H' if g['id'] == 'G1' else 'J'}{i + 1:02d}"
            if g['id'] == 'G2' and t == '06:00':
                continue  # 06:00 장성2교는 보도된 C05로 넣었다
            signals.append({'id': sid, 't': t, 'channel': 'system_alert', 'from': '수위 알림(연동)',
                            'body': f"{g['name']} 수위관측소 {v}m" + (f", {over[-1]} 수위({g['levels'][over[-1]]}m) 이상" if over else ''),
                            'data': {'type': 'gauge', 'gauge': g['id'], 'level_m': v},
                            'record': {'basis': 'record', 'source': '한강홍수통제소 수위 자료(실측)'}})
            next(e for e in expected['incidents'] if e['id'] == EXP_INC[g['id']])['signals'].append(sid)
    c05 = next(s for s in signals if s['id'] == 'C05')
    c05['body'] = f"장성2교 수위관측소 3.54m, 심각 수위({gauges[1]['levels'].get('심각')}m) 이상"

signals.sort(key=lambda s: (s['t'], s['id']))
out = ROOT / 'scenarios' / 'cheongju-20260709.json'
json.dump(scn, open(out, 'w'), ensure_ascii=False, indent=1)
print('저장', out, '신호', len(signals), '흥덕교 시계열', len(scn['timeseries'].get('G1', [])))
