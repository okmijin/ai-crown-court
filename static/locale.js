'use strict';

const query = new URLSearchParams(location.search);
const validLanguage = value => ['zh','en'].includes(value);
let lang = validLanguage(query.get('lang')) ? query.get('lang') : 'zh';
try {
  if (!validLanguage(query.get('lang')) && validLanguage(localStorage.getItem('court-language'))) {
    lang = localStorage.getItem('court-language');
  }
} catch {}
const t = (zh,en) => lang === 'zh' ? zh : en;
const local = value => typeof value === 'object' && value !== null ? (value[lang] || value[t('en','zh')]) : value;
const modes = {uk:['英国皇家刑事法院','UK Crown Court'],full:['全审','Full trial'],quick:['快审','Quick trial']};
const phases = {lodged:['候审中','Awaiting Trial'],opening:['开场陈词','Openings'],rebuttal:['交叉质询','Cross-examination'],
  summing:['总结 · Summing-up','Summing-up'],jury:['陪审团','Jury'],judge:['法官宣判','Verdict']};
const roles = {prosecution:['控方 · Crown','Crown'],defense:['辩方 · Defence','Defence'],
  dock:['证人席','Witness stand'],clerk:['书记员 · Clerk','Clerk'],judge:['法官 · Judge','Judge']};
const beats = {
  lens:['案情分析','Case Lens'], stated_facts:['已陈述事实','Stated facts'],
  assumptions:['假设','Assumptions'], unknowns:['未知事项','Unknowns'],
  witness:['证人席','Witness stand'], answer:['记录答复','Recorded answer'],
  unknown:['未提供 · UNKNOWN','Unknown'], revote:['陪审团复核表决','Jury re-evaluation'],
  changed:['改票','Changed vote'], recommendation:['法官行动建议','Judge’s action recommendation'],
};
const findings = {'有罪':['有罪 · Guilty','Guilty'],'无罪':['无罪 · Not guilty','Not guilty'],
  '陪审团未能达成多数':['陪审团未能达成多数 · Hung jury','Hung jury'],
  '陪审团僵持':['陪审团僵持 · Hung jury','Hung jury'],'未表决':['未表决','Abstained']};
const voteKey = vote => ({guilty:'有罪',not_guilty:'无罪'})[vote] || vote;
const finding = vote => t(...(findings[voteKey(vote)] || ['', '']));
const jurorName = juror => t(juror.name,juror.english);
const disclaimer = () => t('本工具是结构化第二意见，并非法律或职业建议。','This is a structured second opinion, not legal advice.');
const charge = () => t('本案按现有陈述不能成立，不应按所描述的方式推进。','The idea fails as stated and should not go ahead as described.');
const credit = () => t('方法灵感来自 ','Inspired by ');
const eventTranslations = {
  '书记员请双方准备…':'The clerk asks the parties to stand by…',
  '请控辩双方依次陈词。':'The Crown and the Defence may address the court in turn.',
  '开场陈词结束。现在进入交叉反驳。':'The court will now hear cross-examination.',
  '请陪审团依各自视角独立裁决。':'Members of the jury, please reach your own decisions.',
  '全体起立，请法官宣判。':'All rise. The judge will deliver the verdict.',
  '两次尝试均未取得有效表决。':'Two attempts produced no valid ballot.',
};
function courtLine(value) {
  if (typeof value !== 'string') return local(value);
  if (value.startsWith('全体起立，AI 法庭')) {
    return t('全体起立 · All rise。法庭开庭。指控：','All rise. The court is in session. Charge: ') + charge();
  }
  if (value.startsWith('全体起立')) return t('全体起立 · All rise。请法官宣判。',eventTranslations[value]);
  return t(value,eventTranslations[value] || value);
}
const errors = {
  '请出示法庭通行令以查阅私人案卷。':'Enter the court passphrase to view private records.',
  '今日立案名额已满，请明日再试。':'Today’s filing limit has been reached. Please try again tomorrow.',
  '案情陈述最多 2000 字。':'Limit the statement of case to 2,000 characters.',
  '请输入 1 至 200 字案由。':'Enter a charge of 1 to 200 characters.',
  '案情陈述最多 4000 字。':'Limit the statement of case to 4,000 characters.',
  '请出示法庭通行令。':'Present your court pass.',
  '法庭通行令不正确。':'The court pass is incorrect.',
  '通行令错误次数过多，请十五分钟后再试。':'Too many incorrect passes. Try again in 15 minutes.',
  '书记官尚未就位，请稍后再试。':'The clerk is not at the desk yet. Try again later.',
  '书记官无法联系法庭，请稍后再试。':'The clerk could not reach the court. Try again later.',
  '今日立案已满，请明日再来。':'Today\u2019s filings are full. Come back tomorrow.',
  '提交过于频繁，请稍后再试。':'Too many answers submitted. Try again shortly.',
  '这个问题已经作答。':'This question has already been answered.',
  '找不到该证人问题。':'That witness question was not found.',
  '请选择有效选项。':'Choose a valid option.',

  '书记官未能立案，请重试。':'The clerk could not lodge the case. Please try again.',
  '法庭暂时无法响应。':'The court is temporarily unavailable.',
  '案由触发隐私门禁。请删除敏感信息后再开庭。':'The privacy gate blocked this case. Remove sensitive information before submitting.',
  '请输入 1 至 2000 字案由。':'Enter a case of 1 to 2,000 characters.',
  '案由含无法读取的字符。':'The case contains unreadable characters.',
  '请求过长。':'The request is too long.',
  '请求须为 JSON 对象。':'The request must be a JSON object.',
  '请求须为有效的 UTF-8 JSON。':'The request must be valid UTF-8 JSON.',
  '请选择英国皇家刑事法院或全审。':'Choose UK Crown Court or Full trial.',
  '找不到该案。':'Case not found.',
  '上次庭审在服务器停止时中断。':'The trial was interrupted when the server stopped.',
  '英国庭审回复不符合协议。':'A model reply failed the Crown Court protocol checks.',
  '模型回复的字段类型或选项有误。':'A model reply contained an invalid field.',
  '模型回复缺少双语文本。':'A model reply was missing bilingual text.',
  '模型回复缺少字段或包含额外字段。':'A model reply had missing or extra fields.',
  '模型回复中没有可读取的 JSON。':'The model did not return readable JSON.',
  '无法打开 Codex 共用锁。':'The shared Codex lock could not be opened.',
  '等待书记员超过 30 分钟。':'The clerk waited more than 30 minutes for Codex.',
  'Codex 未返回结果。请检查本机 CLI 登录状态。':'Codex returned no result. Check the local CLI sign-in.',
  '模型调用超过 30 分钟。':'The model call exceeded 30 minutes.',
  '无法启动或读取本机 Codex CLI。':'The local Codex CLI could not be started or read.',
};
const errorText = value => t(value || '法庭暂时无法响应。',errors[value] || 'The court could not complete the request.');

const jurors = [
  {
    "name": "会计师",
    "english": "The Accountant"
  },
  {
    "name": "第一次买的顾客",
    "english": "The First-Time Customer"
  },
  {
    "name": "竞争对手",
    "english": "The Competitor"
  },
  {
    "name": "退休法官",
    "english": "The Retired Judge"
  },
  {
    "name": "青少年",
    "english": "The Teenager"
  },
  {
    "name": "工程师",
    "english": "The Engineer"
  },
  {
    "name": "小企业主",
    "english": "The Small-Business Owner"
  },
  {
    "name": "统计学家",
    "english": "The Statistician"
  },
  {
    "name": "家长",
    "english": "The Parent"
  },
  {
    "name": "投资人",
    "english": "The Investor"
  },
  {
    "name": "设计师",
    "english": "The Designer"
  },
  {
    "name": "律师",
    "english": "The Lawyer"
  }
];
