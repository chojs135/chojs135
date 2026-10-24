// 기본 카테고리. 가구별로 복사되며 이후 설정 화면에서 자유롭게 수정할 수 있다.
export const DEFAULT_CATEGORIES: {
  type: "expense" | "income" | "transfer";
  name: string;
  icon: string;
  color: string;
  subcategories: string[];
}[] = [
  { type: "expense", name: "식비", icon: "🍚", color: "#f97316", subcategories: ["장보기", "외식", "배달", "카페/간식"] },
  { type: "expense", name: "주거/관리비", icon: "🏠", color: "#0ea5e9", subcategories: ["관리비", "전기", "수도", "가스/난방", "월세/대출이자", "인터넷/TV", "수선/유지"] },
  { type: "expense", name: "생활용품", icon: "🧺", color: "#14b8a6", subcategories: ["생필품", "가구/가전", "주방용품"] },
  { type: "expense", name: "교통/차량", icon: "🚗", color: "#6366f1", subcategories: ["대중교통", "택시", "주유/충전", "주차/통행료", "정비/세차", "자동차보험"] },
  { type: "expense", name: "통신", icon: "📱", color: "#8b5cf6", subcategories: ["휴대폰"] },
  { type: "expense", name: "의료/건강", icon: "💊", color: "#ef4444", subcategories: ["병원", "약국", "운동", "건강식품"] },
  { type: "expense", name: "의류/미용", icon: "👕", color: "#ec4899", subcategories: ["의류", "신발/잡화", "미용실", "화장품"] },
  { type: "expense", name: "교육/육아", icon: "📚", color: "#eab308", subcategories: ["학원/강의", "도서", "육아용품", "어린이집/학교"] },
  { type: "expense", name: "문화/여가", icon: "🎬", color: "#22c55e", subcategories: ["여행/숙박", "취미", "구독서비스", "영화/공연", "게임"] },
  { type: "expense", name: "경조사/선물", icon: "🎁", color: "#f43f5e", subcategories: ["경조사비", "선물", "부모님 용돈", "기부"] },
  { type: "expense", name: "보험/세금", icon: "🧾", color: "#64748b", subcategories: ["보험료", "세금/공과금", "수수료"] },
  { type: "expense", name: "반려동물", icon: "🐾", color: "#a16207", subcategories: ["사료/간식", "병원", "용품"] },
  { type: "expense", name: "기타지출", icon: "📦", color: "#9ca3af", subcategories: [] },

  { type: "income", name: "급여", icon: "💼", color: "#16a34a", subcategories: ["월급", "상여금"] },
  { type: "income", name: "부수입", icon: "💡", color: "#0d9488", subcategories: ["사업/프리랜스", "중고거래", "포인트/캐시백"] },
  { type: "income", name: "금융수입", icon: "🏦", color: "#2563eb", subcategories: ["이자", "배당", "투자수익"] },
  { type: "income", name: "환급/지원금", icon: "↩️", color: "#7c3aed", subcategories: ["세금환급", "정부지원금", "환불"] },
  { type: "income", name: "기타수입", icon: "➕", color: "#9ca3af", subcategories: ["용돈", "기타"] },

  // 통계에서 빠지는 돈의 이동. 카드대금 출금이나 내 계좌 간 이체를 지출로 세면 이중 집계가 된다.
  { type: "transfer", name: "이체/저축", icon: "🔁", color: "#94a3b8", subcategories: ["카드대금", "내 계좌 이체", "적금/저축", "투자", "대출상환(원금)"] },
];
