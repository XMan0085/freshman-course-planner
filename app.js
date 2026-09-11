/**
 * @fileoverview 新生选课 & GPA 规划工具 — app.js v2
 *
 * Architecture overview:
 *   TRANSLATIONS  — bilingual string table (zh / en)
 *   STATE         — single reactive-style state object
 *   STORAGE       — LocalStorage read/write helpers
 *   ALGORITHMS    — time conflict, scoring, GPA, smart-plan
 *   RENDERERS     — DOM update functions (one per tab/section)
 *   UI HELPERS    — toast, custom dialogs, autosave indicator
 *   EVENTS        — single delegated click handler + form listeners
 *   INIT          — bootstrap on DOMContentLoaded
 *
 * All data is persisted in localStorage; no network calls are made.
 */

(function () {
  'use strict';

  /* ================================================================
     CONSTANTS
  ================================================================ */

  /** LocalStorage key names (versioned to avoid stale data) */
  const SK = {
    LANG:         'fp_lang_v2',
    COURSES:      'fp_courses_v2',
    SELECTED:     'fp_selected_v2',
    TARGET:       'fp_target_v2',
    GPA:          'fp_gpa_v2',
    THEME:        'fp_theme_v2',
    SEMESTERS:    'fp_semesters_v2',
    CURRENT_SEM:  'fp_current_sem_v2',
    ALL_SEM_DATA: 'fp_all_sem_data_v2'
  };

  /** Timetable layout constants (pixels per minute = 1) */
  const TT = {
    START_MIN:   7 * 60,   // 07:00
    END_MIN:    22 * 60,   // 22:00
    PX_PER_MIN: 1,         // 1px == 1 minute
    get HEIGHT() { return (this.END_MIN - this.START_MIN) * this.PX_PER_MIN; } // 900px
  };

  /** Colour palette for timetable course blocks (cycles if >8 courses) */
  const COLORS = [
    { bg:'#dbeafe', text:'#1d4ed8', border:'#3b82f6' },
    { bg:'#dcfce7', text:'#15803d', border:'#22c55e' },
    { bg:'#fce7f3', text:'#be185d', border:'#ec4899' },
    { bg:'#fef3c7', text:'#b45309', border:'#f59e0b' },
    { bg:'#ede9fe', text:'#7c3aed', border:'#8b5cf6' },
    { bg:'#ffedd5', text:'#c2410c', border:'#f97316' },
    { bg:'#cffafe', text:'#0e7490', border:'#06b6d4' },
    { bg:'#f0fdf4', text:'#166534', border:'#16a34a' }
  ];

  /**
   * Stable course-ID → color-index map. Not persisted; rebuilt from COLORS
   * palette on demand. Using a Map keyed by course.id ensures colors never
   * shift when courses are added or deleted (fixes UX-04).
   */
  const _colorMap = new Map();

  /**
   * Returns a stable COLORS palette index for the given course ID.
   * New IDs are assigned the next available slot (wraps at COLORS.length).
   * @param {string} courseId
   * @returns {number}
   */
  function getCourseColorIdx(courseId) {
    if (!_colorMap.has(courseId)) {
      _colorMap.set(courseId, _colorMap.size % COLORS.length);
    }
    return _colorMap.get(courseId);
  }

  /* ================================================================
     TRANSLATIONS  (zh | en)
     Every UI string lives here. t(key) returns the current language.
  ================================================================ */
  const TR = {
    zh: {
      /* App meta */
      appTitle:     '新生选课 & GPA 规划工具',
      appSubtitle:  '零基础 · 纯离线 · 劳逸结合 · 科学排课',
      offlineBadge: '🟢 纯本地离线',
      loadDemo:     '⚡ 载入示例课表',
      autosaved:    '已自动保存',
      langLabel:    'English',

      /* Tabs */
      tabPlanner: '智能选课规划',
      tabCourses: '课程录入与仓库',
      tabGPA:     'GPA 绩点管家',
      tabData:    '数据与说明',

      /* Planner */
      plannerTitle:  '🌱 新生友好智能配课',
      plannerDesc:   '算法优先保障必修课，不超额堆课，按打分智能挑选高品质选修，兼顾课业与休息。',
      creditGuidance:'💡 <strong>新生参考学分：</strong>建议 <strong>12 ~ 18</strong> 学分/学期',
      targetCredit:  '本学期目标学分：',
      credits:       '学分',
      autoplan:      '⚡ 一键智能排课',
      resetPlan:     '重置已选',

      /* Metrics */
      metricCredits:      '当前方案总学分',
      metricDistribution: '课程数量分布',
      metricStress:       '课业压力与劳逸评估',
      mandatory:          '必修',
      elective:           '选修',
      totalSelected:      '共已选',
      coursesUnit:        '门课',

      /* Timetable */
      timetableTitle:    '📅 本周课程时间表',
      timetableSubtitle: '已选课程 · 可视化日程',
      dayMon: '周一', dayTue: '周二', dayWed: '周三', dayThu: '周四', dayFri: '周五',
      dayMonOpt:'星期一 (Mon)', dayTueOpt:'星期二 (Tue)', dayWedOpt:'星期三 (Wed)',
      dayThuOpt:'星期四 (Thu)', dayFriOpt:'星期五 (Fri)',

      /* Planner columns */
      selectedCourses: '✅ 已选定方案课程',
      conflictPassed:  '实时冲突检测已通过',
      backupPool:      '💡 优质备选池',
      backupHint:      '未入选课程 · 点击手动加入',

      /* Course form */
      formTitle:   '✏️ 新增 / 编辑课程',
      formDesc:    '手动逐条录入（无需联网，刷新不丢失）',
      labelCode:   '科目代码', labelName:   '科目名称',
      labelCredits:'学分',     labelDay:    '上课星期',
      labelStart:  '开始时间', labelEnd:    '结束时间',
      labelAttrs:  '课程属性', labelRemarks:'课程 / 教授备注 (选填)',
      phCode:      '如: MATH1001',
      phName:      '如: 高等数学 (A)',
      phRemarks:   '如: 张老师 / 期末开卷',
      attrMandatory:'📌 是否必修 (必修优先配课，打分 +30)',
      attrTight:    '🔥 名额紧张 (仅标识备注，提醒开选即抢)',
      saveCourse:  '➕ 保存课程到仓库',
      saveCourseMod:'💾 确认修改课程',
      cancelEdit:  '取消编辑',

      /* Repo */
      repoTitle:       '📦 全部候选课程库',
      repoDesc:        '包含打分、冲突预警及优先级标签',
      filterAll:       '全部', filterMandatory:'必修',
      filterElective:  '选修', filterConflict: '有冲突',
      scoringRules:    '⚡ 自动打分规则：',
      ruleBase:        '基础 50',
      ruleMandatory:   '必修 +30',
      ruleMorning:     '早八 −15',
      ruleConflict:    '冲突 = 0',

      /* GPA */
      gpaOverview:    '🎯 学业成绩总览',
      gpaSubCredits:  '已修总学分',
      gpaSubAvg:      '加权平均分',
      gpaSubCount:    '已录科目',
      gpaScaleTitle:  '📐 标准 4.0 分制换算参考表',
      colScoreRange:  '百分制', colGP: '绩点', colGrade: '等级',
      gpaEntryTitle:  '📝 成绩录入与管理',
      gpaEntryDesc:   '支持录入已修课程的分数与学分，实时更新总绩点',
      gpaLabelName:   '科目名称', gpaLabelCredits:'学分', gpaLabelScore:'成绩 (0-100)',
      gpaPhName:      '如: 高等数学上',
      addRecord:      '➕ 录入成绩',
      gpaColName:     '科目名称', gpaColCredits:'学分',  gpaColScore:'原始成绩',
      gpaColGP:       '绩点 (4.0)', gpaColWeighted:'加权绩点分', gpaColAction:'操作',
      gpaEmpty:       '暂无成绩记录',
      gpaEmptyHint:   '在上方输入已修课程成绩，体验自动计算 GPA！',

      /* Data tab */
      dataTitle:   '💾 本地数据备份与恢复',
      dataDesc:    '所有数据均存储在您的浏览器 LocalStorage 中，数据完全私密不上传。',
      exportTitle: '导出备份文件 (JSON)', exportDesc: '将当前所有数据导出为本地文件保存。', exportBtn: '📥 导出数据',
      importTitle: '导入备份数据',        importDesc: '选择之前导出的 JSON 文件恢复全部数据。', importBtn: '📤 导入备份',
      resetTitle:  '清空所有本地数据',   resetDesc:  '清除所有录入的课程、排课方案和 GPA 记录。', resetBtn: '🗑️ 清空数据',
      guideTitle:  '📖 新生选课新手指南',
      tip1Title:   '必修课永远第一优先：',
      tip1Body:    '必修课通常是后续高年级核心专业课的前置课程，大一务必优先修读完。',
      tip2Title:   '新生切忌「盲目堆学分」：',
      tip2Body:    '大一第一学期保持在 14~18 学分最利于稳住 GPA 和适应大学节奏。',
      tip3Title:   '警惕「早八」与时间冲突：',
      tip3Body:    '工具已自动将 08:00 开课的早八课扣减 15 分，并对时间重叠课程进行红牌标记。',

      /* Footer */
      disclaimerBadge: '⚠️ 免责声明',
      disclaimerText:  '本工具仅为大学新生提供<strong>离线辅助排课与个人规划参考</strong>，不代表任何学校真实选课系统数据；一切以<strong>校方官方教务系统为准</strong>。',
      footerCopy:      '© 新生选课&GPA规划工具 · 纯前端纯本地 LocalStorage 驱动',

      /* Modals & dialogs */
      notice:      '提示',    ok:         '确定',
      confirmTitle:'确认操作', cancel:     '取消', confirmYes: '确认',
      conflictTitle:'必修课时间冲突警报',
      iKnow:       '我知道了，去调整',
      conflictMsgPrefix: '检测到必修课之间存在时间重叠冲突：',
      conflictMsgSuffix: '建议检查是否有平行教学班，或联系学院教务老师处理。',

      /* Stress levels */
      stressLight:    '学分偏少',     stressLightDesc:    '低于新生建议的 12 学分下限，可能影响修读进度，建议适当在备选池挑选 1-2 门优质通识课。',
      stressMod:      '舒适适中',     stressModDesc:      '非常适合大一新生适应大学节奏，有充足时间参与社团与自习，劳逸结合。',
      stressGold:     '充实黄金期',   stressGoldDesc:     '处于新生黄金推荐学分区间 (16-18)，课程结构充实饱满，稳步推进学业。',
      stressHeavy:    '课业偏重',     stressHeavyDesc:    '已超出新生推荐学分，需合理分配复习时间，谨防期末压力过大。',
      stressOver:     '严重超载',     stressOverDesc:     '学分超过 22！大一新生存在较高挂科或绩点受损风险，强烈建议精简选修！',
      stressDefault:  '请先点击上方「一键智能排课」开始生成方案',
      toastConflictAdd: '⚠️ 该课程与已选课程时间冲突，已强制加入，请前往检查！',

      /* Tags */
      tagPriority:  '优先抢',   tagBackup:     '备选',   tagAvoid:    '不建议',
      tagMorning:   '早八',     tagTight:      '🔥 名额紧', tagInPlan: '已选入',
      tagConflict:  '⚠️ 时间冲突',

      /* Toast messages */
      toastSaved:      '✓ 数据已自动保存',
      toastDemoLoaded: '✓ 示例课表已载入，点击「一键智能排课」体验！',
      toastAdded:      '✓ 课程已添加到仓库',
      toastUpdated:    '✓ 课程信息已更新',
      toastDeleted:    '✓ 课程已删除',
      toastGPAAdded:   '✓ 成绩记录已添加',
      toastGPADeleted: '✓ 成绩记录已删除',
      toastImported:   '✓ 数据导入恢复成功！',
      toastExported:   '✓ 数据已成功导出',
      toastCleared:    '✓ 所有本地数据已清空',
      toastPlanDone:   '✓ 智能排课已完成！',
      toastPlanReset:  '✓ 选课方案已重置',

      /* Errors */
      errTimeInvalid:    '结束时间必须晚于开始时间！',
      errCodeRequired:   '请填写科目代码',
      errNameRequired:   '请填写科目名称',
      errCreditsInvalid: '请填写有效学分 (0.5 – 15)',
      errImportFailed:   '导入失败：文件格式不正确或数据已损坏',
      errNoCourses:      '课程仓库为空！请先在「课程录入与仓库」录入课程，或载入示例课表。',
      errGPAName:        '请填写科目名称',
      errGPACredits:     '请填写有效学分',
      errGPAScore:       '请填写有效成绩 (0–100)',

      /* Confirm dialogs */
      confirmDeleteCourse: '确定要删除这门课程吗？（已选方案中也将同步移除）',
      confirmDeleteGPA:    '确定要删除这条成绩记录吗？',
      confirmResetPlan:    '确定要清空当前的选课方案吗？（课程库不会被删除）',
      confirmClearAll:     '⚠️ 警告：清空后所有本地课程、方案和 GPA 记录将永久删除，无法找回！确定清空吗？',
      confirmLoadDemo:     '载入示例课表将覆盖当前所有数据（包括您已录入的课程），确定要继续吗？',

      /* Empty states */
      emptySelectedTitle: '暂无已选课程',
      emptySelectedHint:  '点击上方「一键智能排课」开始配课',
      emptyBackupTitle:   '备选池为空',
      emptyBackupHint:    '所有课程均已纳入方案，或前往课程仓库添加更多选修课',
      emptyRepoTitle:     '课程库当前为空',
      emptyRepoHint:      '在左侧表单输入课程，或点击顶栏「载入示例课表」快速体验',
      emptyFilterTitle:   '当前筛选下无课程',
      emptyFilterHint:    '可切换顶部筛选标签，或录入更多课程',

      /* Card action buttons */
      editCourse:     '编辑', deleteCourse:  '删除',
      removeFromPlan: '移出方案', addToPlan: '手动加入', deleteRecord: '删除',

      /* Theme (Batch B) */
      themeDark:  '暗黑',
      themeLight: '浅色',

      /* Semesters (Batch B) */
      semesterLabel:        '学期:',
      newSemModalTitle:     '新建学期档案',
      newSemNameLabel:      '学期名称',
      confirmCreate:        '创建并切换',
      cleanSemTitle:        '清理历史旧学期数据',
      cleanSemDesc:         '请勾选要彻底删除的历史学期（当前活跃学期不可删除）：',
      confirmDeleteSelected:'彻底删除所选学期',
      semDefault:           '大一 第一学期',
      toastSemCreated:      '✓ 新学期创建成功并已切换',
      toastSemSwitched:     '✓ 已切换至学期：',
      toastSemCleaned:      '✓ 已清理选定的历史学期数据',
      errSemNameEmpty:      '请输入学期名称',
      errSemNameDup:        '该学期名称已存在',
      noPastSemesters:      '暂无可清理的历史学期档案',

      /* Timetable (Batch B) */
      dayAll: '全部 (5天)',

      /* Rating (Batch B) */
      labelRating: '个人偏好 / 推荐星级 (参与打分权重)',
      star5: '⭐⭐⭐⭐⭐ 强烈推荐 / 极度感兴趣 (+10分)',
      star4: '⭐⭐⭐⭐ 较为推荐 (+5分)',
      star3: '⭐⭐⭐ 一般中立 (基础分)',
      star2: '⭐⭐ 兴趣较低 (-5分)',
      star1: '⭐ 不太想选 (-10分)',

      /* GPA Target Goal Calculator (Batch B) */
      calcGoalTitle:         '🎯 目标绩点逆算规划器 (GPA Target Calculator)',
      calcGoalDesc:          '输入你的期望目标 GPA 及后续剩余待修学分，自动逆算未来每门课需要达到的均分要求与可行性评估。',
      calcLabelTargetGpa:    '期望总绩点目标 (Target GPA, 0-4.0)',
      calcLabelRemCredits:   '后续剩余待修总学分 (Remaining Credits)',
      btnCalcGoal:           '⚡ 立即逆算分析',
      calcResultHeader:      '后续课程所需最低平均绩点',
      calcStatusEasy:        '🟢 较为从容',
      calcStatusGood:        '🔵 稳健良好',
      calcStatusHard:        '🟡 挑战极大',
      calcStatusImpossible:  '🔴 无法达成 (超出满绩)',
      calcAdviceEasy:        '后续课程保持在 2.5~3.0 (75~80分) 即可稳步达成，心态放平！',
      calcAdviceGood:        '合理且进取的目标！后续课程需保持在 3.0~3.6 (80~89分) 良好水平。',
      calcAdviceHard:        '目标要求极高！后续课程需保持 3.7+ (几乎全 A/90分以上)，需投入充足复习精力。',
      calcAdviceImpossible:  '即使剩余所有课程全部拿满分 4.0 (A)，总绩点最高仅能达到 {maxGpa}，建议适当调整预期或分摊更多学分。',

      /* IndexedDB (Batch B) */
      dbCardTitle:      '🗄️ 浏览器数据库 (IndexedDB)',
      dbCardDesc:       '纯本地结构化事务数据库，数据持久保存，无需上传云端；支持灵活清理历史学期。',
      idbStatusActive:  'IndexedDB: 运行正常 · 双重镜像持久化',
      dbChipSemesters:  '学期数:',
      dbChipCourses:    '课程总计:',
      dbChipGpa:        '成绩记录:',
      cleanPastTitle:   '清理历史旧学期数据',
      cleanPastDesc:    '满足「无需长期保存以往数据」需求，保留当前活跃学期，安全释放历史缓存。',
      btnCleanPast:     '🧹 清理旧学期',
    },

    en: {
      /* App meta */
      appTitle:     'Freshman Course Planner & GPA Tool',
      appSubtitle:  'Offline · Smart · Balanced · Student-Friendly',
      offlineBadge: '🟢 100% Offline',
      loadDemo:     '⚡ Load Sample Schedule',
      autosaved:    'Auto-saved',
      langLabel:    '中文',

      /* Tabs */
      tabPlanner: 'Smart Planner',
      tabCourses: 'Courses & Repo',
      tabGPA:     'GPA Manager',
      tabData:    'Data & Guide',

      /* Planner */
      plannerTitle:  '🌱 Freshman-Friendly Smart Planner',
      plannerDesc:   'Required courses first. No credit overloading. Electives are selected by score, respecting your target.',
      creditGuidance:'💡 <strong>Recommended for Freshmen:</strong> <strong>12 ~ 18</strong> credits / semester',
      targetCredit:  'Target Credits This Semester:',
      credits:       'Credits',
      autoplan:      '⚡ Auto-Plan Now',
      resetPlan:     'Reset Plan',

      /* Metrics */
      metricCredits:      'Total Planned Credits',
      metricDistribution: 'Course Distribution',
      metricStress:       'Workload Assessment',
      mandatory:          'Required',
      elective:           'Elective',
      totalSelected:      'Total:',
      coursesUnit:        'courses',

      /* Timetable */
      timetableTitle:    '📅 Weekly Schedule View',
      timetableSubtitle: 'Selected Courses · Visual Timetable',
      dayMon:'Mon', dayTue:'Tue', dayWed:'Wed', dayThu:'Thu', dayFri:'Fri',
      dayMonOpt:'Monday',  dayTueOpt:'Tuesday', dayWedOpt:'Wednesday',
      dayThuOpt:'Thursday',dayFriOpt:'Friday',

      /* Planner columns */
      selectedCourses: '✅ Selected Courses',
      conflictPassed:  'No conflicts detected',
      backupPool:      '💡 Backup Pool',
      backupHint:      'Click any course to add it manually',

      /* Course form */
      formTitle:   '✏️ Add / Edit Course',
      formDesc:    'Enter courses manually (no internet needed, data persists on refresh)',
      labelCode:   'Course Code',   labelName:   'Course Name',
      labelCredits:'Credits',       labelDay:    'Day of Week',
      labelStart:  'Start Time',    labelEnd:    'End Time',
      labelAttrs:  'Attributes',    labelRemarks:'Notes / Professor (optional)',
      phCode:      'e.g. MATH1001',
      phName:      'e.g. Calculus I',
      phRemarks:   'e.g. Prof. Smith / Open book final',
      attrMandatory:'📌 Required Course (Priority placement, +30 score)',
      attrTight:    '🔥 Limited Seats (reminder only, grab it fast!)',
      saveCourse:  '➕ Save to Repository',
      saveCourseMod:'💾 Confirm Update',
      cancelEdit:  'Cancel',

      /* Repo */
      repoTitle:      '📦 Course Repository',
      repoDesc:       'Includes scores, conflict warnings, and priority tags',
      filterAll:      'All',       filterMandatory:'Required',
      filterElective: 'Elective',  filterConflict: 'Conflicted',
      scoringRules:   '⚡ Scoring:',
      ruleBase:       'Base 50',
      ruleMandatory:  'Required +30',
      ruleMorning:    'Early AM −15',
      ruleConflict:   'Conflict = 0',

      /* GPA */
      gpaOverview:    '🎯 Academic Summary',
      gpaSubCredits:  'Completed Credits',
      gpaSubAvg:      'Weighted Avg',
      gpaSubCount:    'Courses',
      gpaScaleTitle:  '📐 4.0 GPA Conversion Table',
      colScoreRange:  'Score', colGP: 'GPA Pts', colGrade: 'Grade',
      gpaEntryTitle:  '📝 Record & Manage Grades',
      gpaEntryDesc:   'Log completed course scores and credits to track cumulative GPA',
      gpaLabelName:   'Course Name', gpaLabelCredits:'Credits', gpaLabelScore:'Score (0–100)',
      gpaPhName:      'e.g. Calculus I',
      addRecord:      '➕ Add Record',
      gpaColName:     'Course', gpaColCredits:'Credits', gpaColScore:'Score',
      gpaColGP:       'GPA Pts', gpaColWeighted:'Weighted', gpaColAction:'Action',
      gpaEmpty:       'No records yet',
      gpaEmptyHint:   'Add completed course scores above to calculate your GPA!',

      /* Data tab */
      dataTitle:   '💾 Data Backup & Restore',
      dataDesc:    "All data is stored in your browser's LocalStorage. It's completely private.",
      exportTitle: 'Export Backup (JSON)',  exportDesc: 'Export all courses, plans, and GPA records as a JSON file.',    exportBtn: '📥 Export Data',
      importTitle: 'Import Backup',         importDesc: 'Select a previously exported JSON file to restore all data.',   importBtn: '📤 Import Backup',
      resetTitle:  'Clear All Local Data',  resetDesc:  'Permanently delete all courses, plans, and GPA records.',       resetBtn: '🗑️ Clear All',
      guideTitle:  '📖 Freshman Quick Guide',
      tip1Title:   'Required courses always come first:',
      tip1Body:    "They're prerequisites for upper-year courses. Always prioritize completing them in Year 1.",
      tip2Title:   "Don't overload!",
      tip2Body:    'Aim for 14–18 credits your first semester. College is harder than high school — protect your GPA.',
      tip3Title:   'Watch out for early AM classes and conflicts:',
      tip3Body:    'The tool auto-penalizes 8AM courses (−15 pts) and flags all time conflicts in red.',

      /* Footer */
      disclaimerBadge: '⚠️ Disclaimer',
      disclaimerText:  'This tool provides <strong>offline planning assistance only</strong>. It does not represent real course data from any institution. For official selections, always refer to <strong>your school\'s academic system</strong>.',
      footerCopy:      '© Freshman Course Planner & GPA Tool · Pure frontend, 100% local storage',

      /* Modals */
      notice:      'Notice',    ok:         'OK',
      confirmTitle:'Confirm Action', cancel: 'Cancel', confirmYes: 'Confirm',
      conflictTitle:'⚠️ Required Course Conflict Alert',
      iKnow:       "Understood, I'll Adjust",
      conflictMsgPrefix: 'Required courses have time overlaps:',
      conflictMsgSuffix: 'Check for alternative class sections, or contact your academic advisor.',

      /* Stress levels */
      stressLight:  'Light Load',   stressLightDesc:  'Below the recommended 12-credit minimum. Consider adding 1–2 quality electives from the backup pool.',
      stressMod:    'Comfortable',  stressModDesc:    'Great balance for freshmen! Plenty of time for clubs, social life, and studying.',
      stressGold:   'Ideal Balance',stressGoldDesc:   'In the sweet spot (16–18 credits). Busy but very manageable for a motivated freshman.',
      stressHeavy:  'Heavy Load',   stressHeavyDesc:  'Above recommended load. Manage your study time carefully to avoid exam-week burnout.',
      stressOver:   'Overloaded!',  stressOverDesc:   'Over 22 credits! High risk of poor grades as a freshman. Strongly consider dropping some electives.',
      stressDefault: 'Click "Auto-Plan Now" above to generate your course plan',
      toastConflictAdd: '⚠️ This course conflicts with your current plan, but was added. Please review!',

      /* Tags */
      tagPriority: 'Must Take', tagBackup: 'Backup',  tagAvoid:  'Avoid',
      tagMorning:  'Early AM',  tagTight:  '🔥 Limited', tagInPlan: 'In Plan',
      tagConflict: '⚠️ Conflict',

      /* Toasts */
      toastSaved:      '✓ Data auto-saved',
      toastDemoLoaded: '✓ Sample schedule loaded! Click "Auto-Plan" to try it.',
      toastAdded:      '✓ Course added to repository',
      toastUpdated:    '✓ Course info updated',
      toastDeleted:    '✓ Course deleted',
      toastGPAAdded:   '✓ Grade record added',
      toastGPADeleted: '✓ Grade record deleted',
      toastImported:   '✓ Data imported successfully!',
      toastExported:   '✓ Data exported successfully',
      toastCleared:    '✓ All local data cleared',
      toastPlanDone:   '✓ Smart plan generated!',
      toastPlanReset:  '✓ Course plan reset',

      /* Errors */
      errTimeInvalid:    'End time must be later than start time!',
      errCodeRequired:   'Please enter a course code',
      errNameRequired:   'Please enter a course name',
      errCreditsInvalid: 'Please enter valid credits (0.5 – 15)',
      errImportFailed:   'Import failed: invalid or corrupted file format',
      errNoCourses:      'Repository is empty! Add courses in the "Courses & Repo" tab, or load the sample schedule.',
      errGPAName:        'Please enter a course name',
      errGPACredits:     'Please enter valid credits',
      errGPAScore:       'Please enter a valid score (0–100)',

      /* Confirms */
      confirmDeleteCourse: 'Delete this course? (It will also be removed from your current plan)',
      confirmDeleteGPA:    'Delete this grade record?',
      confirmResetPlan:    'Reset your current course plan? (Repository is unaffected)',
      confirmClearAll:     '⚠️ WARNING: All courses, plans, and GPA records will be permanently deleted and cannot be recovered!\n\nAre you sure?',
      confirmLoadDemo:     'Loading the sample schedule will overwrite all your current data. Continue?',

      /* Empty states */
      emptySelectedTitle: 'No courses selected yet',
      emptySelectedHint:  'Click "Auto-Plan Now" above to get started',
      emptyBackupTitle:   'Backup pool is empty',
      emptyBackupHint:    'All compatible courses are already in your plan',
      emptyRepoTitle:     'Repository is empty',
      emptyRepoHint:      'Add courses using the form, or load the sample schedule',
      emptyFilterTitle:   'No courses match this filter',
      emptyFilterHint:    'Switch filters or add more courses',

      /* Card actions */
      editCourse:     'Edit',   deleteCourse:  'Delete',
      removeFromPlan: 'Remove', addToPlan:     'Add to Plan', deleteRecord: 'Delete',

      /* Theme (Batch B) */
      themeDark:  'Dark',
      themeLight: 'Light',

      /* Semesters (Batch B) */
      semesterLabel:        'Semester:',
      newSemModalTitle:     'New Semester Profile',
      newSemNameLabel:      'Semester Name',
      confirmCreate:        'Create & Switch',
      cleanSemTitle:        'Clean Past Semester Data',
      cleanSemDesc:         'Check past semesters to permanently delete (current semester cannot be deleted):',
      confirmDeleteSelected:'Permanently Delete Selected',
      semDefault:           'Year 1 Fall Semester',
      toastSemCreated:      '✓ New semester created and switched',
      toastSemSwitched:     '✓ Switched to semester: ',
      toastSemCleaned:      '✓ Selected past semesters cleaned',
      errSemNameEmpty:      'Please enter a semester name',
      errSemNameDup:        'This semester name already exists',
      noPastSemesters:      'No past semester profiles available to clean',

      /* Timetable (Batch B) */
      dayAll: 'All (5 Days)',

      /* Rating (Batch B) */
      labelRating: 'Personal Preference / Star Rating (Affects Score)',
      star5: '⭐⭐⭐⭐⭐ Highly Recommended / Passionate (+10 pts)',
      star4: '⭐⭐⭐⭐ Recommended (+5 pts)',
      star3: '⭐⭐⭐ Neutral (Base score)',
      star2: '⭐⭐ Low Interest (-5 pts)',
      star1: '⭐ Dislike (-10 pts)',

      /* GPA Target Goal Calculator (Batch B) */
      calcGoalTitle:         '🎯 GPA Target Goal Calculator',
      calcGoalDesc:          'Calculate the exact average grade point and percentage required in your remaining courses to achieve your dream cumulative GPA.',
      calcLabelTargetGpa:    'Target Cumulative GPA (0–4.0)',
      calcLabelRemCredits:   'Remaining Credits to Complete',
      btnCalcGoal:           '⚡ Calculate Target Requirements',
      calcResultHeader:      'Required Average GP for Future Courses',
      calcStatusEasy:        '🟢 Very Feasible',
      calcStatusGood:        '🔵 Balanced & Achievable',
      calcStatusHard:        '🟡 Highly Demanding',
      calcStatusImpossible:  '🔴 Mathematically Unattainable',
      calcAdviceEasy:        'Maintain an average of 2.5–3.0 (75–80%) across future courses to steadily reach your goal.',
      calcAdviceGood:        'Great balanced target! Aim for an average of 3.0–3.6 (80–89%) in upcoming classes.',
      calcAdviceHard:        'Extremely ambitious! You will need almost all A grades (90%+ or 3.7+ GP) in upcoming courses.',
      calcAdviceImpossible:  'Even with a perfect 4.0 in every remaining credit, the maximum achievable cumulative GPA is {maxGpa}. Consider adjusting your target.',

      /* IndexedDB (Batch B) */
      dbCardTitle:      '🗄️ Browser Database (IndexedDB)',
      dbCardDesc:       'Pure client-side structured database with dual-layer mirror persistence; easily clean past records on demand.',
      idbStatusActive:  'IndexedDB: Active & Healthy · Dual-Layer Mirroring',
      dbChipSemesters:  'Semesters:',
      dbChipCourses:    'Total Courses:',
      dbChipGpa:        'Grade Records:',
      cleanPastTitle:   'Clean Past Semesters',
      cleanPastDesc:    'Meet the "no need to store past records indefinitely" preference; keep only active courses and prune old semesters.',
      btnCleanPast:     '🧹 Clean Past Semesters',
    }
  };

  /* ================================================================
     APPLICATION STATE  (single source of truth)
  ================================================================ */
  const state = {
    lang:               'zh',          // Current UI language
    theme:              'light',       // 'light' | 'dark'
    courses:            [],            // Array of course objects for current semester
    selectedIds:        [],            // IDs of courses in the active plan
    targetCredits:      16,            // User's target credits for this semester
    gpaRecords:         [],            // GPA history records for current semester
    repoFilter:         'all',         // Active filter in course repo tab
    activeTimetableDay: 'all',         // 'all' | '1'..'5'
    semesters:          [],            // Array of semester descriptors
    currentSemesterId:  'sem_default', // Active semester ID
    allSemestersData:   {}             // Map: { [semId]: { courses, selectedIds, targetCredits, gpaRecords } }
  };

  /* ================================================================
     DEMO DATA  — preloaded on first launch to help new users
  ================================================================ */
  const DEMO_COURSES = [
    { id:'dm1', code:'MATH1001', name:'高等数学 (A) 上 / Calculus I',  credits:5, day:'1', startTime:'08:00', endTime:'09:40', isMandatory:true,  isTight:false, remarks:'高数教研组 · Prof. Lee' },
    { id:'dm2', code:'ENG1001',  name:'大学英语 (一) / College English', credits:3, day:'2', startTime:'10:00', endTime:'11:40', isMandatory:true,  isTight:false, remarks:'需自备耳机 / Bring earphones' },
    { id:'dm3', code:'CS1001',   name:'程序设计基础 / Python Basics',    credits:3, day:'3', startTime:'14:00', endTime:'16:30', isMandatory:true,  isTight:true,  remarks:'含上机实验 / Lab included' },
    { id:'dm4', code:'POLI1001', name:'思想道德与法治 / Ethics & Law',   credits:3, day:'4', startTime:'10:00', endTime:'11:40', isMandatory:true,  isTight:false, remarks:'大班课 · 开卷考试' },
    { id:'dm5', code:'PE1001',   name:'大学体育 (羽毛球) / Badminton',  credits:1, day:'5', startTime:'14:00', endTime:'15:40', isMandatory:false, isTight:true,  remarks:'需自备球拍 / Bring racket' },
    { id:'dm6', code:'GEN1002',  name:'心理学与生活 / Psychology & Life',credits:2, day:'3', startTime:'19:00', endTime:'20:40', isMandatory:false, isTight:true,  remarks:'通识热门课，给分优' },
    { id:'dm7', code:'GEN1003',  name:'批判性思维 / Critical Thinking',  credits:2, day:'2', startTime:'14:00', endTime:'15:40', isMandatory:false, isTight:false, remarks:'论文结课 / Essay-based' },
    { id:'dm8', code:'ART1001',  name:'音乐赏析 / Music Appreciation',   credits:1.5,day:'4',startTime:'08:00', endTime:'09:40', isMandatory:false, isTight:false, remarks:'早八通识课 / Early AM class' },
    { id:'dm9', code:'BUS1001',  name:'创业认知 / Entrepreneurship',     credits:2, day:'1', startTime:'08:30', endTime:'10:10', isMandatory:false, isTight:false, remarks:'⚠️ 与高数冲突示例 / Conflict demo' }
  ];

  const DEMO_GPA = [
    { id:'gd1', name:'高等数学 (A) 上', credits:5, score:91 },
    { id:'gd2', name:'大学英语 (一)',    credits:3, score:86 },
    { id:'gd3', name:'程序设计基础',     credits:3, score:94 },
    { id:'gd4', name:'思想道德与法治',   credits:3, score:82 },
    { id:'gd5', name:'大学体育 (一)',    credits:1, score:88 }
  ];

  /* ================================================================
     i18n HELPERS
  ================================================================ */

  /**
   * Returns the translated string for the given key in the current language.
   * Falls back to the key name itself if not found.
   * @param {string} key
   * @returns {string}
   */
  function t(key) {
    return (TR[state.lang] && TR[state.lang][key]) || key;
  }

  /**
   * Switches the application language and re-applies all translations.
   * @param {'zh'|'en'} lang
   */
  function setLang(lang) {
    // UX-01: Preserve all form field values before re-translating, because
    // applyTranslations() rewrites <option> textContent which can reset the
    // currently selected <select> value in some browsers.
    const savedFormVals = _captureFormValues();
    state.lang = lang;
    localStorage.setItem(SK.LANG, lang);
    applyTranslations();
    _restoreFormValues(savedFormVals);
    renderAll();
  }

  /**
   * Captures all course-entry form field values into a plain object.
   * Called before applyTranslations() during a language switch.
   * @returns {Object}
   */
  function _captureFormValues() {
    const ids = ['course-code','course-name','course-credits','course-day',
                 'course-start-time','course-end-time','course-remarks',
                 'course-rating','form-course-id'];
    const vals = {};
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) vals[id] = el.value;
    });
    const chk1 = document.getElementById('course-is-mandatory');
    const chk2 = document.getElementById('course-is-tight');
    if (chk1) vals['course-is-mandatory'] = chk1.checked;
    if (chk2) vals['course-is-tight']     = chk2.checked;
    return vals;
  }

  /**
   * Restores course-entry form field values from a previously captured snapshot.
   * Called after applyTranslations() during a language switch.
   * @param {Object} vals
   */
  function _restoreFormValues(vals) {
    Object.entries(vals).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (typeof val === 'boolean') el.checked = val;
      else el.value = val;
    });
  }

  /**
   * Walks all [data-i18n], [data-i18n-html], [data-i18n-placeholder],
   * and [data-i18n-opt] elements and updates their content / attributes
   * according to the current language.
   */
  function applyTranslations() {
    const lang = state.lang;

    // Update <html lang>
    document.getElementById('html-root').lang = lang === 'zh' ? 'zh-CN' : 'en';

    // textContent translations
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const val = t(el.getAttribute('data-i18n'));
      if (val) el.textContent = val;
    });

    // innerHTML translations (for strings containing HTML tags)
    document.querySelectorAll('[data-i18n-html]').forEach(el => {
      const val = t(el.getAttribute('data-i18n-html'));
      if (val) el.innerHTML = val;
    });

    // placeholder translations
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const val = t(el.getAttribute('data-i18n-placeholder'));
      if (val) el.placeholder = val;
    });

    // <option> text translations
    document.querySelectorAll('[data-i18n-opt]').forEach(el => {
      const val = t(el.getAttribute('data-i18n-opt'));
      if (val) el.textContent = val;
    });

    // Language toggle label
    const langLabel = document.getElementById('lang-toggle-label');
    if (langLabel) langLabel.textContent = t('langLabel');

    // Theme toggle label
    const themeLabel = document.getElementById('theme-toggle-label');
    if (themeLabel) themeLabel.textContent = state.theme === 'dark' ? t('themeLight') : t('themeDark');
  }

  /* ================================================================
     INDEXEDDB MODULE (Browser-Native Structured Storage)
  ================================================================ */
  const IDB = {
    _db: null,

    async init() {
      if (!window.indexedDB) {
        console.warn('[IDB] IndexedDB not available, falling back to LocalStorage only.');
        return null;
      }
      return new Promise((resolve) => {
        const req = window.indexedDB.open('UniversityPlannerDB', 1);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('semesters')) {
            db.createObjectStore('semesters', { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains('courses')) {
            const cs = db.createObjectStore('courses', { keyPath: 'id' });
            cs.createIndex('semesterId', 'semesterId', { unique: false });
          }
          if (!db.objectStoreNames.contains('gpa')) {
            const gs = db.createObjectStore('gpa', { keyPath: 'id' });
            gs.createIndex('semesterId', 'semesterId', { unique: false });
          }
          if (!db.objectStoreNames.contains('meta')) {
            db.createObjectStore('meta', { keyPath: 'key' });
          }
        };
        req.onsuccess = (e) => {
          this._db = e.target.result;
          resolve(this._db);
        };
        req.onerror = (e) => {
          console.warn('[IDB] Open error:', e);
          resolve(null);
        };
      });
    },

    async syncFromState() {
      if (!this._db) return;
      try {
        const tx = this._db.transaction(['semesters', 'courses', 'gpa', 'meta'], 'readwrite');

        // Meta store
        const metaStore = tx.objectStore('meta');
        metaStore.put({ key: 'theme', val: state.theme });
        metaStore.put({ key: 'lang', val: state.lang });
        metaStore.put({ key: 'currentSemesterId', val: state.currentSemesterId });
        metaStore.put({ key: 'targetCredits', val: state.targetCredits });
        metaStore.put({ key: 'selectedIds', val: state.selectedIds });

        // Semesters store
        const semStore = tx.objectStore('semesters');
        semStore.clear();
        (state.semesters || []).forEach(s => semStore.put(s));

        // Courses store
        const courseStore = tx.objectStore('courses');
        courseStore.clear();
        (state.courses || []).forEach(c => courseStore.put({ ...c, semesterId: state.currentSemesterId }));
        if (state.allSemestersData) {
          Object.entries(state.allSemestersData).forEach(([semId, semData]) => {
            if (semId !== state.currentSemesterId && semData && semData.courses) {
              semData.courses.forEach(c => courseStore.put({ ...c, semesterId: semId }));
            }
          });
        }

        // GPA store
        const gpaStore = tx.objectStore('gpa');
        gpaStore.clear();
        (state.gpaRecords || []).forEach(g => gpaStore.put({ ...g, semesterId: state.currentSemesterId }));
        if (state.allSemestersData) {
          Object.entries(state.allSemestersData).forEach(([semId, semData]) => {
            if (semId !== state.currentSemesterId && semData && semData.gpaRecords) {
              semData.gpaRecords.forEach(g => gpaStore.put({ ...g, semesterId: semId }));
            }
          });
        }
      } catch (err) {
        console.warn('[IDB] Sync transaction error:', err);
      }
    }
  };

  /* ================================================================
     STORAGE HELPERS
  ================================================================ */

  /** Loads all persisted state from localStorage. */
  function loadAll() {
    try {
      state.lang              = localStorage.getItem(SK.LANG)        || 'zh';
      state.theme             = localStorage.getItem(SK.THEME)       || 'light';
      state.currentSemesterId = localStorage.getItem(SK.CURRENT_SEM) || 'sem_default';
      state.semesters         = JSON.parse(localStorage.getItem(SK.SEMESTERS) || 'null') || [
        { id: 'sem_default', nameZh: '大一 第一学期', nameEn: 'Year 1 Fall Semester', createdAt: Date.now() }
      ];
      state.allSemestersData  = JSON.parse(localStorage.getItem(SK.ALL_SEM_DATA) || 'null') || {};

      state.courses       = JSON.parse(localStorage.getItem(SK.COURSES)  || 'null') || [];
      state.selectedIds   = JSON.parse(localStorage.getItem(SK.SELECTED) || 'null') || [];
      state.targetCredits = parseFloat(localStorage.getItem(SK.TARGET)) || 16;
      state.gpaRecords    = JSON.parse(localStorage.getItem(SK.GPA)      || 'null') || [];

      // First-run: populate with demo data
      if (state.courses.length === 0) {
        state.courses    = JSON.parse(JSON.stringify(DEMO_COURSES));
        state.gpaRecords = JSON.parse(JSON.stringify(DEMO_GPA));
        if (!state.allSemestersData[state.currentSemesterId]) {
          state.allSemestersData[state.currentSemesterId] = {
            courses: state.courses,
            selectedIds: state.selectedIds,
            targetCredits: state.targetCredits,
            gpaRecords: state.gpaRecords
          };
        }
        saveAll();
      }
    } catch (e) {
      console.warn('[FP] LocalStorage read error, using defaults:', e);
      state.courses    = JSON.parse(JSON.stringify(DEMO_COURSES));
      state.gpaRecords = JSON.parse(JSON.stringify(DEMO_GPA));
    }
  }

  /** Persists the full state to localStorage and mirrors to IndexedDB. */
  function saveAll() {
    if (!state.allSemestersData) state.allSemestersData = {};
    state.allSemestersData[state.currentSemesterId] = {
      courses: state.courses,
      selectedIds: state.selectedIds,
      targetCredits: state.targetCredits,
      gpaRecords: state.gpaRecords
    };

    localStorage.setItem(SK.LANG,         state.lang);
    localStorage.setItem(SK.THEME,        state.theme);
    localStorage.setItem(SK.CURRENT_SEM,  state.currentSemesterId);
    localStorage.setItem(SK.SEMESTERS,    JSON.stringify(state.semesters));
    localStorage.setItem(SK.ALL_SEM_DATA, JSON.stringify(state.allSemestersData));
    localStorage.setItem(SK.COURSES,      JSON.stringify(state.courses));
    localStorage.setItem(SK.SELECTED,     JSON.stringify(state.selectedIds));
    localStorage.setItem(SK.TARGET,       String(state.targetCredits));
    localStorage.setItem(SK.GPA,          JSON.stringify(state.gpaRecords));

    // Dual-layer mirror persistence into browser IndexedDB
    IDB.syncFromState();

    showAutosave();
  }

  /* ================================================================
     THEME (Dark / Light Mode)
  ================================================================ */
  function applyTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    const icon = document.getElementById('theme-toggle-icon');
    const label = document.getElementById('theme-toggle-label');
    if (icon) icon.textContent = theme === 'dark' ? '☀️' : '🌙';
    if (label) label.textContent = theme === 'dark' ? t('themeLight') : t('themeDark');
    localStorage.setItem(SK.THEME, theme);
  }

  function toggleTheme() {
    const next = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    IDB.syncFromState();
  }

  /* ================================================================
     SEMESTER MANAGEMENT
  ================================================================ */
  function renderSemesterSelect() {
    const sel = document.getElementById('semester-select');
    if (!sel) return;
    sel.innerHTML = state.semesters.map(s => {
      const name = state.lang === 'zh' ? (s.nameZh || s.nameEn) : (s.nameEn || s.nameZh);
      return `<option value="${esc(s.id)}">${esc(name)}</option>`;
    }).join('');
    sel.value = state.currentSemesterId;
  }

  function switchSemester(newSemId) {
    if (newSemId === state.currentSemesterId) return;

    if (!state.allSemestersData) state.allSemestersData = {};
    state.allSemestersData[state.currentSemesterId] = {
      courses: state.courses,
      selectedIds: state.selectedIds,
      targetCredits: state.targetCredits,
      gpaRecords: state.gpaRecords
    };

    state.currentSemesterId = newSemId;

    const semData = state.allSemestersData[newSemId] || {
      courses: [],
      selectedIds: [],
      targetCredits: 16,
      gpaRecords: []
    };

    state.courses       = semData.courses || [];
    state.selectedIds   = semData.selectedIds || [];
    state.targetCredits = semData.targetCredits || 16;
    state.gpaRecords    = semData.gpaRecords || [];

    saveAll();
    renderAll();

    const currentSem = state.semesters.find(s => s.id === newSemId);
    const semName = currentSem ? (state.lang === 'zh' ? (currentSem.nameZh || currentSem.nameEn) : (currentSem.nameEn || currentSem.nameZh)) : '';
    showToast(`${t('toastSemSwitched')}${semName}`);
  }

  function openNewSemesterModal() {
    const modal = document.getElementById('modal-new-semester');
    const input = document.getElementById('input-new-sem-name');
    if (input) input.value = '';
    if (modal) modal.style.display = 'flex';
    if (input) setTimeout(() => input.focus(), 80);
  }

  function closeNewSemesterModal() {
    const modal = document.getElementById('modal-new-semester');
    if (modal) modal.style.display = 'none';
  }

  function confirmNewSemester() {
    const input = document.getElementById('input-new-sem-name');
    const name = input ? input.value.trim() : '';
    if (!name) {
      showToast(t('errSemNameEmpty'), 'error');
      return;
    }
    const exists = state.semesters.some(s => s.nameZh === name || s.nameEn === name);
    if (exists) {
      showToast(t('errSemNameDup'), 'error');
      return;
    }

    const newId = 'sem_' + Date.now();
    state.semesters.push({
      id: newId,
      nameZh: name,
      nameEn: name,
      createdAt: Date.now()
    });

    if (!state.allSemestersData) state.allSemestersData = {};
    state.allSemestersData[newId] = {
      courses: [],
      selectedIds: [],
      targetCredits: 16,
      gpaRecords: []
    };

    closeNewSemesterModal();
    switchSemester(newId);
    showToast(t('toastSemCreated'), 'success');
  }

  function openCleanSemestersModal() {
    const modal = document.getElementById('modal-clean-semesters');
    const cont = document.getElementById('clean-sem-list-container');
    if (!modal || !cont) return;

    const past = state.semesters.filter(s => s.id !== state.currentSemesterId);
    if (past.length === 0) {
      cont.innerHTML = `<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:0.9rem;">${t('noPastSemesters')}</div>`;
    } else {
      cont.innerHTML = past.map(s => {
        const name = state.lang === 'zh' ? (s.nameZh || s.nameEn) : (s.nameEn || s.nameZh);
        const countCourses = (state.allSemestersData[s.id]?.courses || []).length;
        const countGpa = (state.allSemestersData[s.id]?.gpaRecords || []).length;
        return `
          <label style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid var(--border);cursor:pointer;">
            <input type="checkbox" class="clean-sem-checkbox" value="${esc(s.id)}" />
            <span style="font-weight:600;color:var(--text);">${esc(name)}</span>
            <span style="font-size:0.8rem;color:var(--text-muted);margin-left:auto;">(${countCourses}门课程, ${countGpa}条GPA)</span>
          </label>`;
      }).join('');
    }
    modal.style.display = 'flex';
  }

  function closeCleanSemestersModal() {
    const modal = document.getElementById('modal-clean-semesters');
    if (modal) modal.style.display = 'none';
  }

  async function confirmCleanSemesters() {
    const checked = Array.from(document.querySelectorAll('.clean-sem-checkbox:checked')).map(el => el.value);
    if (checked.length === 0) {
      closeCleanSemestersModal();
      return;
    }

    const ok = await showConfirm(t('confirmDeleteSelected') + ` (${checked.length})?`);
    if (!ok) return;

    state.semesters = state.semesters.filter(s => !checked.includes(s.id));
    checked.forEach(id => {
      delete state.allSemestersData[id];
    });

    closeCleanSemestersModal();
    saveAll();
    renderAll();
    showToast(t('toastSemCleaned'), 'success');
  }

  /* ================================================================
     GPA TARGET GOAL CALCULATOR
  ================================================================ */
  function calculateGpaTargetGoal() {
    const targetGpaInp = document.getElementById('target-gpa-val');
    const remCreditsInp = document.getElementById('target-rem-credits');
    if (!targetGpaInp || !remCreditsInp) return;

    const targetGpa = parseFloat(targetGpaInp.value) || 3.70;
    const remCredits = parseFloat(remCreditsInp.value) || 16.0;

    let currCredits = 0, currTotalGP = 0;
    state.gpaRecords.forEach(r => {
      const cr = Number(r.credits) || 0;
      const gp = scoreToGP(r.score);
      currCredits += cr;
      currTotalGP += gp * cr;
    });

    const totalFutureCredits = currCredits + remCredits;
    const targetTotalGP = targetGpa * totalFutureCredits;
    const reqFutureGP = targetTotalGP - currTotalGP;
    const reqAvgGP = remCredits > 0 ? (reqFutureGP / remCredits) : targetGpa;

    const reqEl = document.getElementById('calc-req-gp');
    const chipEl = document.getElementById('calc-status-chip');
    const adviceEl = document.getElementById('calc-advice-text');

    if (reqAvgGP > 4.0) {
      const maxPossibleGpa = totalFutureCredits > 0 ? ((currTotalGP + 4.0 * remCredits) / totalFutureCredits).toFixed(2) : '4.00';
      if (reqEl) reqEl.textContent = reqAvgGP.toFixed(2);
      if (chipEl) {
        chipEl.className = 'calc-needed-chip badge-danger';
        chipEl.textContent = t('calcStatusImpossible');
      }
      if (adviceEl) {
        adviceEl.textContent = t('calcAdviceImpossible').replace('{maxGpa}', maxPossibleGpa);
      }
    } else if (reqAvgGP >= 3.7) {
      if (reqEl) reqEl.textContent = reqAvgGP.toFixed(2);
      if (chipEl) {
        chipEl.className = 'calc-needed-chip badge-hard';
        chipEl.textContent = t('calcStatusHard');
      }
      if (adviceEl) adviceEl.textContent = t('calcAdviceHard');
    } else if (reqAvgGP >= 3.0) {
      if (reqEl) reqEl.textContent = reqAvgGP.toFixed(2);
      if (chipEl) {
        chipEl.className = 'calc-needed-chip badge-mod';
        chipEl.textContent = t('calcStatusGood');
      }
      if (adviceEl) adviceEl.textContent = t('calcAdviceGood');
    } else {
      if (reqEl) reqEl.textContent = Math.max(0, reqAvgGP).toFixed(2);
      if (chipEl) {
        chipEl.className = 'calc-needed-chip badge-easy';
        chipEl.textContent = t('calcStatusEasy');
      }
      if (adviceEl) adviceEl.textContent = t('calcAdviceEasy');
    }
  }

  /* ================================================================
     DATA TAB & DATABASE STATS
  ================================================================ */
  function renderDataTab() {
    const semCount = (state.semesters && state.semesters.length) || 1;
    let totalCourses = state.courses.length;
    let totalGpa = state.gpaRecords.length;

    if (state.allSemestersData) {
      Object.entries(state.allSemestersData).forEach(([semId, data]) => {
        if (semId !== state.currentSemesterId && data) {
          totalCourses += (data.courses || []).length;
          totalGpa += (data.gpaRecords || []).length;
        }
      });
    }

    const semEl = document.getElementById('db-stat-semesters');
    const crsEl = document.getElementById('db-stat-courses');
    const gpaEl = document.getElementById('db-stat-gpa');
    if (semEl) semEl.textContent = semCount;
    if (crsEl) crsEl.textContent = totalCourses;
    if (gpaEl) gpaEl.textContent = totalGpa;
  }

  /** Flashes the autosave indicator for 2 seconds. */
  function showAutosave() {
    const el = document.getElementById('autosave-indicator');
    const txt = document.getElementById('autosave-text');
    if (!el) return;
    if (txt) txt.textContent = t('autosaved');
    el.classList.add('visible');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('visible'), 2200);
  }

  /** Updates the course count badge in the tab navigation. */
  function updateCourseCountBadge() {
    const el = document.getElementById('course-count-badge');
    if (el) el.textContent = state.courses.length;
  }

  /* ================================================================
     ALGORITHMS
  ================================================================ */

  /**
   * Converts a "HH:mm" time string to total minutes since midnight.
   * @param {string} timeStr
   * @returns {number}
   */
  function timeToMinutes(timeStr) {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  }

  /**
   * Determines whether two courses have overlapping time slots on the same day.
   * Uses the standard interval overlap formula: startA < endB && startB < endA.
   * @param {object} c1
   * @param {object} c2
   * @returns {boolean}
   */
  function isConflict(c1, c2) {
    if (c1.id === c2.id)                         return false;
    // BUG-03: coerce to string so imported JSON with integer day values
    // (e.g. day:1 instead of day:'1') still produce correct conflict checks.
    if (String(c1.day) !== String(c2.day))       return false;
    const s1 = timeToMinutes(c1.startTime), e1 = timeToMinutes(c1.endTime);
    const s2 = timeToMinutes(c2.startTime), e2 = timeToMinutes(c2.endTime);
    return s1 < e2 && s2 < e1;
  }

  /**
   * Returns all courses in `pool` that conflict with `course`.
   * @param {object} course
   * @param {object[]} pool
   * @returns {object[]}
   */
  function conflictsWith(course, pool) {
    return pool.filter(other => isConflict(course, other));
  }

  /**
   * Returns true if the course starts at 08:30 or earlier (early-morning penalty).
   * @param {string} startTime  "HH:mm"
   * @returns {boolean}
   */
  function isMorningClass(startTime) {
    return timeToMinutes(startTime) <= timeToMinutes('08:30');
  }

  /**
   * Computes the 0–100 priority score for a course.
   *
   * Scoring rules (fixed, simple):
   *   Base:            50
   *   Required course: +30
   *   Early AM start:  -15
   *   Time conflict:    0  (overrides everything)
   *
   * @param {object}  course
   * @param {boolean} hasConflict
   * @returns {{ score:number, tag:string, tagClass:string }}
   */
  function computeScore(course, hasConflict) {
    if (hasConflict) {
      return { score: 0, tag: t('tagConflict'), tagClass: 'priority-low' };
    }
    let score = 50;
    if (course.isMandatory)               score += 30;
    if (isMorningClass(course.startTime)) score -= 15;
    const rating = Number(course.rating) || 3;
    if (rating === 5) score += 10;
    else if (rating === 4) score += 5;
    else if (rating === 2) score -= 5;
    else if (rating === 1) score -= 10;
    score = Math.max(0, Math.min(100, score));

    let tag = t('tagBackup'), tagClass = 'priority-medium';
    if (score >= 70) { tag = t('tagPriority'); tagClass = 'priority-high'; }
    else if (score < 40) { tag = t('tagAvoid'); tagClass = 'priority-low'; }

    return { score, tag, tagClass };
  }

  /**
   * Converts a 0–100 percentage score to a standard 4.0 GPA grade point.
   * @param {number} score
   * @returns {number}
   */
  function scoreToGP(score) {
    const n = parseFloat(score);
    if (isNaN(n) || n < 60) return 0.0;
    if (n >= 90) return 4.0;
    if (n >= 85) return 3.7;
    if (n >= 82) return 3.3;
    if (n >= 78) return 3.0;
    if (n >= 75) return 2.7;
    if (n >= 72) return 2.3;
    if (n >= 68) return 2.0;
    if (n >= 64) return 1.5;
    return 1.0;
  }

  /**
   * Returns a stress-level object based on the total planned credits.
   * @param {number} credits
   * @returns {{ badge:string, cls:string, icon:string, desc:string }}
   */
  function stressLevel(credits) {
    if (credits < 12)  return { badge:t('stressLight'), cls:'level-light',    icon:'🏖️', desc:t('stressLightDesc') };
    if (credits <= 15) return { badge:t('stressMod'),   cls:'level-moderate', icon:'🌱', desc:t('stressModDesc')   };
    if (credits <= 18) return { badge:t('stressGold'),  cls:'level-standard', icon:'🎯', desc:t('stressGoldDesc')  };
    if (credits <= 21) return { badge:t('stressHeavy'), cls:'level-heavy',    icon:'⚡', desc:t('stressHeavyDesc') };
    return             { badge:t('stressOver'),          cls:'level-overload', icon:'🚨', desc:t('stressOverDesc')  };
  }

  /**
   * Runs the freshman-friendly smart course selection algorithm:
   *
   * Step 1 — Detect and warn about mandatory course conflicts (modal).
   * Step 2 — Add ALL non-conflicting required courses to the plan first.
   * Step 3 — Compute remaining credit budget.
   * Step 4 — Score and sort electives; greedily add highest-scoring ones
   *           that fit within the remaining budget and have no conflicts.
   * Step 5 — Stop immediately when the target is reached (no overfilling).
   */
  function runSmartPlan() {
    if (state.courses.length === 0) {
      showAlert(t('errNoCourses'), 'warn');
      return;
    }

    const mandatory = state.courses.filter(c => c.isMandatory);
    const elective  = state.courses.filter(c => !c.isMandatory);
    const chosen    = [];
    let credits     = 0;

    /* ---- Step 1: detect mandatory-vs-mandatory conflicts ---- */
    const mandatoryConflicts = [];
    for (let i = 0; i < mandatory.length; i++) {
      for (let j = i + 1; j < mandatory.length; j++) {
        if (isConflict(mandatory[i], mandatory[j])) {
          mandatoryConflicts.push({ c1: mandatory[i], c2: mandatory[j] });
        }
      }
    }
    if (mandatoryConflicts.length > 0) showConflictModal(mandatoryConflicts);

    /* ---- Step 2: add required courses (skip if conflicts within chosen) ---- */
    for (const c of mandatory) {
      if (!chosen.some(x => isConflict(x, c))) {
        chosen.push(c);
        credits += Number(c.credits);
      }
    }

    /* ---- Step 3: greedily fill electives by score ---- */
    const remaining = state.targetCredits - credits;
    if (remaining > 0) {
      const scored = elective
        .map(c => ({
          ...c,
          _conflict: chosen.some(x => isConflict(x, c)),
          _score:    computeScore(c, chosen.some(x => isConflict(x, c))).score
        }))
        .filter(c => !c._conflict)
        .sort((a, b) => b._score - a._score);

      for (const c of scored) {
        const needed = Number(c.credits);
        if (credits + needed <= state.targetCredits &&
            !chosen.some(x => isConflict(x, c))) {
          chosen.push(c);
          credits += needed;
        }
        if (credits >= state.targetCredits) break;
      }
    }

    /* ---- Step 4: persist and re-render ---- */
    state.selectedIds = chosen.map(c => c.id);
    saveAll();
    renderPlannerTab();
    showToast(t('toastPlanDone'), 'success');
  }

  /* ================================================================
     RENDERERS
  ================================================================ */

  /** Refreshes all visible tabs. Called after language change or full data reload. */
  function renderAll() {
    applyTheme(state.theme);
    renderSemesterSelect();
    updateCourseCountBadge();
    renderPlannerTab();
    renderRepoTab();
    renderGPATab();
    renderDataTab();
  }

  /** HTML-escapes a string to prevent XSS. */
  function esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  }

  /** Generates a unique ID for new records. */
  function uid() {
    return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2,5);
  }

  /** Day display names keyed by day string ('1'–'5'). */
  function dayName(day) {
    const keys = { '1':'dayMon','2':'dayTue','3':'dayWed','4':'dayThu','5':'dayFri' };
    return t(keys[day] || 'dayMon');
  }

  /**
   * Builds the HTML for a single course card.
   * Used in both the planner columns and the repository list.
   *
   * @param {object}  course
   * @param {'selected'|'backup'|'repo'} mode
   * @param {number}  colorIdx  — index into COLORS palette (for timetable consistency)
   * @returns {string} HTML string
   */
  function buildCourseCard(course, mode) {
    const conflicts   = conflictsWith(course, state.courses);
    const hasConflict = conflicts.length > 0;
    const score       = computeScore(course, hasConflict);
    const isSelected  = state.selectedIds.includes(course.id);
    // UX-04: Use stable color map keyed by course.id so colors don't shift
    // when courses are added or deleted from the repository.
    const color       = COLORS[getCourseColorIdx(course.id)];

    // Build action buttons depending on context
    let actionBtns = '';
    if (mode === 'selected') {
      actionBtns = `<button class="btn btn-outline btn-sm" data-action="remove-plan" data-id="${esc(course.id)}">${t('removeFromPlan')}</button>`;
    } else if (mode === 'backup') {
      actionBtns = `<button class="btn btn-secondary btn-sm" data-action="add-plan" data-id="${esc(course.id)}">${t('addToPlan')}</button>`;
    } else {
      // repo mode
      actionBtns = `
        <button class="btn btn-outline btn-sm" data-action="edit-course" data-id="${esc(course.id)}">${t('editCourse')}</button>
        <button class="btn btn-danger btn-sm"  data-action="delete-course" data-id="${esc(course.id)}">${t('deleteCourse')}</button>
      `;
    }

    const conflictWarning = hasConflict ? `
      <div class="conflict-warning-box">
        ⚠️ ${t('tagConflict')}: ${conflicts.map(c => `【${esc(c.name)}】`).join('、')}
      </div>` : '';

    const starCount = Math.max(1, Math.min(5, Number(course.rating) || 3));

    return `
      <div class="course-card ${course.isMandatory ? 'is-mandatory-border' : ''} ${hasConflict ? 'is-conflict-card' : ''}">
        <div class="card-top-row">
          <div class="card-title-group">
            <span class="course-title-text">${esc(course.name)}</span>
            <span class="course-code-pill">${esc(course.code)}</span>
            ${isSelected && mode === 'repo' ? `<span class="tag-in-plan">${t('tagInPlan')}</span>` : ''}
          </div>
          <div class="card-tags">
            <span class="score-badge ${score.tagClass}">⭐ ${score.score} · ${score.tag}</span>
            <span class="card-stars-chip" title="偏好: ${starCount}星">${'★'.repeat(starCount)}</span>
            ${course.isMandatory ? `<span class="tag-mandatory">${t('mandatory')}</span>` : ''}
            ${course.isTight     ? `<span class="tag-tight">${t('tagTight')}</span>` : ''}
            ${isMorningClass(course.startTime) ? `<span class="tag-morning">${t('tagMorning')}</span>` : ''}
          </div>
        </div>
        <div class="card-info-row">
          <div class="info-item">📅 <strong>${dayName(course.day)}</strong></div>
          <div class="info-item">⏰ <strong>${esc(course.startTime)} – ${esc(course.endTime)}</strong></div>
          <div class="info-item">🎓 <strong>${course.credits} ${t('credits')}</strong></div>
        </div>
        ${conflictWarning}
        <div class="card-bottom-actions">
          <span class="course-remarks-text" title="${esc(course.remarks || '')}">
            ${course.remarks ? `💬 ${esc(course.remarks)}` : ''}
          </span>
          <div class="action-buttons-group">${actionBtns}</div>
        </div>
      </div>`;
  }

  /** Empty-state HTML helper. */
  function emptyHTML(icon, title, hint) {
    return `<div class="empty-state">
      <div class="empty-icon">${icon}</div>
      <p>${title}</p>
      <p class="empty-hint">${hint}</p>
    </div>`;
  }

  /* ---- Planner Tab ---- */

  /** Renders Tab 1: Smart Planner (metrics + timetable + selected + backup). */
  function renderPlannerTab() {
    // Sync credit input
    const inp = document.getElementById('target-credit-input');
    if (inp && document.activeElement !== inp) inp.value = state.targetCredits;

    document.getElementById('metric-target-credits').textContent = state.targetCredits.toFixed(1);

    const selected = state.courses.filter(c => state.selectedIds.includes(c.id));
    let totalCr = 0, mandCount = 0, elecCount = 0;
    selected.forEach(c => {
      totalCr   += Number(c.credits);
      if (c.isMandatory) mandCount++; else elecCount++;
    });

    // Metrics panel
    document.getElementById('metric-current-credits').textContent = totalCr.toFixed(1);
    document.getElementById('metric-mandatory-count').textContent = mandCount;
    document.getElementById('metric-elective-count').textContent  = elecCount;
    document.getElementById('metric-total-courses').textContent   = selected.length;

    const pct = Math.min(100, Math.round((totalCr / (state.targetCredits || 1)) * 100));
    document.getElementById('credit-progress-fill').style.width = pct + '%';

    // Stress evaluation
    const sl = stressLevel(totalCr);
    const badge = document.getElementById('stress-level-badge');
    if (badge) { badge.className = `stress-badge ${sl.cls}`; badge.textContent = sl.badge; }
    const iconEl = document.getElementById('stress-icon');
    if (iconEl) iconEl.textContent = sl.icon;
    const desc = document.getElementById('stress-description');
    // UX-05: use i18n key instead of hardcoded bilingual ternary
    if (desc) desc.textContent = selected.length > 0 ? sl.desc : t('stressDefault');

    // Timetable
    renderTimetable(selected);

    // Selected courses column
    const selCont = document.getElementById('selected-courses-container');
    document.getElementById('selected-list-count').textContent = selected.length;
    if (selCont) {
      selCont.innerHTML = selected.length === 0
        ? emptyHTML('📝', t('emptySelectedTitle'), t('emptySelectedHint'))
        : selected.map(c => buildCourseCard(c, 'selected')).join('');
    }

    // Backup pool column (courses NOT in plan)
    const backup = state.courses.filter(c => !state.selectedIds.includes(c.id));
    const bakCont = document.getElementById('backup-courses-container');
    document.getElementById('backup-list-count').textContent = backup.length;
    if (bakCont) {
      bakCont.innerHTML = backup.length === 0
        ? emptyHTML('🗂️', t('emptyBackupTitle'), t('emptyBackupHint'))
        : backup.map(c => buildCourseCard(c, 'backup')).join('');
    }
  }

  /* ---- Timetable Renderer ---- */

  /**
   * Renders the visual weekly timetable grid using absolute pixel positioning.
   *
   * Layout math (PX_PER_MIN = 1):
   *   course top    = (startMin - TT.START_MIN) × 1
   *   course height = (endMin   - startMin)     × 1
   *   total height  = 900px (07:00 – 22:00)
   *
   * @param {object[]} selectedCourses
   */
  function renderTimetable(selectedCourses) {
    const section = document.getElementById('timetable-section');
    if (!section) return;

    if (selectedCourses.length === 0) {
      section.style.display = 'none';
      return;
    }
    section.style.display = 'block';

    const H = TT.HEIGHT; // 900px

    // ---- Render time-label column ----
    const timeCol = document.getElementById('tt-time-col');
    if (timeCol) {
      timeCol.style.height = H + 'px';
      timeCol.innerHTML = '';
      for (let h = 7; h <= 22; h++) {
        const top = (h * 60 - TT.START_MIN) * TT.PX_PER_MIN;
        const lbl = document.createElement('div');
        lbl.className   = 'tt-time-label';
        lbl.style.top   = top + 'px';
        lbl.textContent = h.toString().padStart(2,'0') + ':00';
        timeCol.appendChild(lbl);
      }
    }

    // ---- Set day column heights and clear old blocks ----
    for (let d = 1; d <= 5; d++) {
      const col = document.getElementById(`tt-col-${d}`);
      if (col) {
        col.style.height = H + 'px';
        col.querySelectorAll('.tt-course-block').forEach(el => el.remove());
      }
    }

    // ---- Add course blocks ----
    selectedCourses.forEach((course, idx) => {
      const col = document.getElementById(`tt-col-${course.day}`);
      if (!col) return;

      const startMin = timeToMinutes(course.startTime);
      const endMin   = timeToMinutes(course.endTime);

      // Skip courses entirely outside the timetable range
      if (endMin <= TT.START_MIN || startMin >= TT.START_MIN + H) return;

      const top    = Math.max(0, (startMin - TT.START_MIN) * TT.PX_PER_MIN);
      const height = Math.max(20, (endMin - startMin)       * TT.PX_PER_MIN);
      // UX-04: stable color by course.id — same color regardless of sort order
      const color  = COLORS[getCourseColorIdx(course.id)];

      const block = document.createElement('div');
      block.className = 'tt-course-block';
      block.style.cssText = `top:${top}px;height:${height}px;background:${color.bg};color:${color.text};border-left-color:${color.border};`;
      // Native tooltip as accessible fallback
      block.title = `${course.code} | ${course.name}\n${course.startTime}–${course.endTime} | ${course.credits} ${t('credits')}`;

      block.innerHTML = `
        <div class="tt-block-name">${esc(course.name)}</div>
        ${height >= 32 ? `<div class="tt-block-time">${course.startTime}–${course.endTime}</div>` : ''}
        ${height >= 52 ? `<div class="tt-block-credits">${course.credits} ${t('credits')}</div>` : ''}
        ${course.isMandatory ? '<span class="tt-mandatory-dot">📌</span>' : ''}
      `;

      col.appendChild(block);
    });
    // Sync mobile day focus & pill highlight
    const wrap = document.getElementById('timetable-wrapper');
    if (wrap) {
      wrap.setAttribute('data-day-focus', state.activeTimetableDay || 'all');
    }
    document.querySelectorAll('.tt-day-pill').forEach(btn => {
      const dv = btn.getAttribute('data-day-view');
      btn.classList.toggle('active', dv === (state.activeTimetableDay || 'all'));
    });
  }

  /* ---- Repository Tab ---- */

  /** Renders Tab 2: Course Repository with current filter applied. */
  function renderRepoTab() {
    const total = state.courses.length;
    document.getElementById('repo-total-count').textContent = total;
    updateCourseCountBadge();

    let filtered = state.courses;
    if (state.repoFilter === 'mandatory') filtered = filtered.filter(c =>  c.isMandatory);
    if (state.repoFilter === 'elective')  filtered = filtered.filter(c => !c.isMandatory);
    if (state.repoFilter === 'conflict')  filtered = filtered.filter(c => conflictsWith(c, state.courses).length > 0);

    const cont = document.getElementById('repo-courses-container');
    if (!cont) return;

    if (filtered.length === 0) {
      cont.innerHTML = total === 0
        ? emptyHTML('📂', t('emptyRepoTitle'),    t('emptyRepoHint'))
        : emptyHTML('🔍', t('emptyFilterTitle'),  t('emptyFilterHint'));
      return;
    }

    cont.innerHTML = filtered.map(c => buildCourseCard(c, 'repo')).join('');
  }

  /* ---- GPA Tab ---- */

  /** Renders Tab 3: GPA Manager (stats + record table). */
  function renderGPATab() {
    let totalCr = 0, totalGP = 0, totalWScore = 0;
    state.gpaRecords.forEach(r => {
      const cr = Number(r.credits), sc = Number(r.score);
      const gp = scoreToGP(sc);
      totalCr      += cr;
      totalGP      += gp * cr;
      totalWScore  += sc * cr;
    });

    const gpa     = totalCr > 0 ? (totalGP / totalCr).toFixed(2)     : '0.00';
    const avgScore = totalCr > 0 ? (totalWScore / totalCr).toFixed(1) : '—';

    document.getElementById('gpa-cumulative-val').textContent  = gpa;
    document.getElementById('gpa-total-credits').textContent   = totalCr.toFixed(1);
    document.getElementById('gpa-weighted-score').textContent  = avgScore;
    document.getElementById('gpa-course-count').textContent    = state.gpaRecords.length;

    const tbody    = document.getElementById('gpa-tbody');
    const emptyEl  = document.getElementById('gpa-empty-state');

    if (state.gpaRecords.length === 0) {
      if (tbody)   tbody.innerHTML = '';
      if (emptyEl) emptyEl.style.display = 'block';
    } else {
      if (emptyEl) emptyEl.style.display = 'none';
      if (tbody) {
        tbody.innerHTML = state.gpaRecords.map(r => {
          const gp = scoreToGP(r.score);
          const wt = (gp * Number(r.credits)).toFixed(2);
          // BUG-04: gpClass was computed but never used — removed dead code
          return `<tr>
            <td><strong>${esc(r.name)}</strong></td>
            <td>${r.credits}</td>
            <td>${r.score}</td>
            <td><span class="score-badge priority-${gp>=3.5?'high':gp>=2?'medium':'low'}">${gp.toFixed(1)}</span></td>
            <td>${wt}</td>
            <td>
              <button class="btn btn-danger btn-sm" data-action="delete-gpa" data-id="${esc(r.id)}">${t('deleteRecord')}</button>
            </td>
          </tr>`;
        }).join('');
      }
    }

    // Auto-calculate GPA target goal with latest stats
    calculateGpaTargetGoal();
  }

  /* ================================================================
     UI HELPERS — Toast, Custom Alert, Custom Confirm, Conflict Modal
  ================================================================ */

  /**
   * Displays a non-blocking toast notification.
   * Replaces native alert() for informational messages.
   *
   * @param {string}           message
   * @param {'success'|'error'|'info'} type
   * @param {number}           duration   milliseconds before auto-dismiss
   */
  function showToast(message, type = 'success', duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const icons = { success:'✓', error:'✕', info:'ℹ' };
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ'}</span><span class="toast-message">${esc(message)}</span>`;
    container.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
      requestAnimationFrame(() => toast.classList.add('show'));
    });

    // Auto-remove
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 350);
    }, duration);
  }

  /**
   * Displays a custom alert modal (replaces native alert()).
   * @param {string} message
   * @param {'info'|'warn'|'error'} type
   */
  function showAlert(message, type = 'info') {
    const modal   = document.getElementById('custom-alert-modal');
    const body    = document.getElementById('alert-modal-body');
    const header  = document.getElementById('alert-modal-header');
    const iconEl  = document.getElementById('alert-modal-icon');
    const titleEl = document.getElementById('alert-modal-title');

    if (!modal) return;

    const config = {
      info:  { icon:'ℹ️',  title: t('notice'), cls: '' },
      warn:  { icon:'⚠️', title: t('notice'), cls: 'modal-header-warning' },
      error: { icon:'❌', title: t('notice'), cls: 'modal-header-danger'  }
    };
    const cfg = config[type] || config.info;

    if (body)    body.textContent    = message;
    if (iconEl)  iconEl.textContent  = cfg.icon;
    if (titleEl) titleEl.textContent = cfg.title;
    if (header)  header.className    = `modal-header ${cfg.cls}`;

    modal.style.display = 'flex';
  }

  /* Promise-based custom confirm dialog state */
  let _confirmResolve = null;

  /**
   * Displays a custom confirm modal (replaces native confirm()).
   * Returns a Promise that resolves with true (OK) or false (Cancel).
   *
   * @param {string} message
   * @returns {Promise<boolean>}
   */
  function showConfirm(message) {
    return new Promise(resolve => {
      _confirmResolve = resolve;
      const body = document.getElementById('confirm-modal-body');
      if (body) body.textContent = message;
      document.getElementById('custom-confirm-modal').style.display = 'flex';
    });
  }

  /**
   * Displays the mandatory-conflict detail modal.
   * @param {Array<{c1:object, c2:object}>} conflicts
   */
  function showConflictModal(conflicts) {
    const modal = document.getElementById('conflict-modal');
    const body  = document.getElementById('conflict-modal-body');
    if (!modal || !body) return;

    const list = conflicts.map(({c1, c2}) =>
      `<div style="background:#fff;border:1px solid #fecaca;padding:9px 12px;border-radius:8px;margin-bottom:6px;">
        🔴 <strong>【${esc(c1.name)}】</strong> ↔ <strong>【${esc(c2.name)}】</strong>
        — ${dayName(c1.day)} ${c1.startTime}–${c1.endTime}
      </div>`
    ).join('');

    body.innerHTML = `
      <p style="font-weight:600;margin-bottom:12px;color:#991b1b;">${t('conflictMsgPrefix')}</p>
      ${list}
      <p style="font-size:.84rem;color:#64748b;margin-top:10px;">💡 ${t('conflictMsgSuffix')}</p>
    `;
    modal.style.display = 'flex';
  }

  /* ================================================================
     FORM HELPERS
  ================================================================ */

  /** Shows an inline error message in the course form. */
  function showFormError(msg) {
    const box = document.getElementById('form-error-box');
    const txt = document.getElementById('form-error-text');
    if (box && txt) { txt.textContent = msg; box.style.display = 'flex'; }
  }

  /** Hides the inline form error. */
  function hideFormError() {
    const box = document.getElementById('form-error-box');
    if (box) box.style.display = 'none';
  }

  /** Populates the course form for editing an existing course. */
  function populateFormForEdit(course) {
    document.getElementById('form-course-id').value          = course.id;
    document.getElementById('course-code').value             = course.code;
    document.getElementById('course-name').value             = course.name;
    document.getElementById('course-credits').value          = course.credits;
    document.getElementById('course-day').value              = course.day;
    document.getElementById('course-start-time').value       = course.startTime;
    document.getElementById('course-end-time').value         = course.endTime;
    document.getElementById('course-is-mandatory').checked   = course.isMandatory;
    document.getElementById('course-is-tight').checked       = course.isTight;
    document.getElementById('course-remarks').value          = course.remarks || '';
    const ratingEl = document.getElementById('course-rating');
    if (ratingEl) ratingEl.value = String(course.rating || '3');

    document.getElementById('btn-save-course').textContent  = t('saveCourseMod');
    document.getElementById('btn-cancel-edit').style.display = 'inline-flex';
    hideFormError();
    document.querySelector('.form-card').scrollIntoView({ behavior:'smooth' });
  }

  /**
   * Resets the course form to "Add new course" state.
   * BUG-05: Avoid form.reset() because it fires a change event before manual
   * time-field overrides in some browsers, causing a brief empty-field flash.
   * Instead, clear each field explicitly in deterministic order.
   */
  function resetCourseForm() {
    document.getElementById('form-course-id').value          = '';
    document.getElementById('course-code').value             = '';
    document.getElementById('course-name').value             = '';
    document.getElementById('course-credits').value          = '';
    document.getElementById('course-day').value              = '1';
    document.getElementById('course-start-time').value       = '08:00';
    document.getElementById('course-end-time').value         = '09:40';
    document.getElementById('course-is-mandatory').checked   = false;
    document.getElementById('course-is-tight').checked       = false;
    document.getElementById('course-remarks').value          = '';
    const ratingEl = document.getElementById('course-rating');
    if (ratingEl) ratingEl.value = '3';
    document.getElementById('btn-save-course').textContent   = t('saveCourse');
    document.getElementById('btn-cancel-edit').style.display = 'none';
    hideFormError();
  }

  /* ================================================================
     EVENT HANDLING  (single delegated click listener for the page)
  ================================================================ */

  /**
   * Master click handler. All button-level events are handled here
   * via data-action, data-tab, and data-filter attributes, eliminating duplicate
   * addEventListener calls that caused v1 bugs.
   *
   * @param {MouseEvent} e
   */
  async function handleGlobalClick(e) {
    // Check for mobile timetable day pills
    const dayPill = e.target.closest('.tt-day-pill');
    if (dayPill) {
      state.activeTimetableDay = dayPill.getAttribute('data-day-view') || 'all';
      renderTimetable(state.courses.filter(c => state.selectedIds.includes(c.id)));
      return;
    }

    const btn = e.target.closest('[data-action],[data-tab],[data-filter]');
    if (!btn) return;

    /* ---- Tab navigation ---- */
    if (btn.dataset.tab) {
      document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === btn.dataset.tab);
        b.setAttribute('aria-selected', b.dataset.tab === btn.dataset.tab);
      });
      document.querySelectorAll('.tab-pane').forEach(p => {
        p.classList.toggle('active', p.id === btn.dataset.tab);
      });
      if (btn.dataset.tab === 'tab-courses') renderRepoTab();
      if (btn.dataset.tab === 'tab-gpa')     renderGPATab();
      if (btn.dataset.tab === 'tab-data')    renderDataTab();
      return;
    }

    /* ---- Repo filter pills ---- */
    if (btn.dataset.filter) {
      document.querySelectorAll('.filter-pill').forEach(p =>
        p.classList.toggle('active', p.dataset.filter === btn.dataset.filter)
      );
      state.repoFilter = btn.dataset.filter;
      renderRepoTab();
      return;
    }

    const action = btn.dataset.action;
    const id     = btn.dataset.id;

    switch (action) {

      /* ---- Theme ---- */
      case 'toggle-theme':
        toggleTheme();
        break;

      /* ---- Semesters ---- */
      case 'open-new-sem':
        openNewSemesterModal();
        break;

      case 'close-new-sem':
        closeNewSemesterModal();
        break;

      case 'confirm-new-sem':
        confirmNewSemester();
        break;

      case 'open-clean-sem':
        openCleanSemestersModal();
        break;

      case 'close-clean-sem':
        closeCleanSemestersModal();
        break;

      case 'confirm-delete-semesters':
        confirmCleanSemesters();
        break;

      /* ---- GPA Calculator ---- */
      case 'calc-gpa-goal':
        calculateGpaTargetGoal();
        break;

      /* ---- Planner ---- */
      case 'remove-plan':
        state.selectedIds = state.selectedIds.filter(x => x !== id);
        saveAll(); renderPlannerTab();
        break;

      case 'add-plan': {
        if (!state.selectedIds.includes(id)) {
          // UX-02: Detect conflict before silently adding — warn but still allow
          const addingCourse    = state.courses.find(x => x.id === id);
          const alreadySelected = state.courses.filter(c => state.selectedIds.includes(c.id));
          if (addingCourse) {
            const clashes = conflictsWith(addingCourse, alreadySelected);
            if (clashes.length > 0) {
              showToast(
                `${t('toastConflictAdd')} [${clashes.map(c => c.name).join(', ')}]`,
                'error', 5000
              );
            }
          }
          state.selectedIds.push(id);
          saveAll(); renderPlannerTab();
        }
        break;
      }

      /* ---- Repo ---- */
      case 'edit-course': {
        const c = state.courses.find(x => x.id === id);
        if (c) {
          populateFormForEdit(c);
          // Switch to repo tab if not already active
          document.querySelector('[data-tab="tab-courses"]').click();
        }
        break;
      }

      case 'delete-course': {
        const ok = await showConfirm(t('confirmDeleteCourse'));
        if (!ok) break;
        state.courses     = state.courses.filter(x => x.id !== id);
        state.selectedIds = state.selectedIds.filter(x => x !== id);
        saveAll(); renderRepoTab(); renderPlannerTab();
        showToast(t('toastDeleted'));
        break;
      }

      /* ---- GPA ---- */
      case 'delete-gpa': {
        const ok = await showConfirm(t('confirmDeleteGPA'));
        if (!ok) break;
        state.gpaRecords = state.gpaRecords.filter(x => x.id !== id);
        saveAll(); renderGPATab();
        showToast(t('toastGPADeleted'));
        break;
      }

      /* ---- Modal buttons ---- */
      case 'alert-ok':
        document.getElementById('custom-alert-modal').style.display = 'none';
        break;

      case 'confirm-yes':
        document.getElementById('custom-confirm-modal').style.display = 'none';
        if (_confirmResolve) { _confirmResolve(true); _confirmResolve = null; }
        break;

      case 'confirm-no':
        document.getElementById('custom-confirm-modal').style.display = 'none';
        if (_confirmResolve) { _confirmResolve(false); _confirmResolve = null; }
        break;

      case 'close-conflict':
        document.getElementById('conflict-modal').style.display = 'none';
        break;

      case 'conflict-ok':
        document.getElementById('conflict-modal').style.display = 'none';
        break;
    }
  }

  /** Attaches all non-delegated event listeners (forms, special buttons). */
  function initListeners() {

    /* Global delegated click */
    document.addEventListener('click', handleGlobalClick);

    /* Wire modal button data-actions (they're not inside the main nav area) */
    bindDataAction('btn-alert-ok',         'alert-ok');
    bindDataAction('btn-confirm-yes',       'confirm-yes');
    bindDataAction('btn-confirm-no',        'confirm-no');
    bindDataAction('btn-close-conflict',    'close-conflict');
    bindDataAction('btn-conflict-ok',       'conflict-ok');

    /* Close modals by clicking the backdrop */
    ['custom-alert-modal','custom-confirm-modal','conflict-modal','modal-new-semester','modal-clean-semesters'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', e => {
        if (e.target === el) {
          // Only auto-close non-confirm modals on backdrop click
          if (id !== 'custom-confirm-modal') el.style.display = 'none';
        }
      });
    });

    /* Semester selector change */
    document.getElementById('semester-select')?.addEventListener('change', e => {
      switchSemester(e.target.value);
    });

    /* Language toggle */
    document.getElementById('btn-lang-toggle')?.addEventListener('click', () => {
      setLang(state.lang === 'zh' ? 'en' : 'zh');
    });

    /* Load demo button */
    document.getElementById('btn-load-demo')?.addEventListener('click', async () => {
      const ok = await showConfirm(t('confirmLoadDemo'));
      if (!ok) return;
      state.courses     = JSON.parse(JSON.stringify(DEMO_COURSES));
      state.selectedIds = [];
      state.gpaRecords  = JSON.parse(JSON.stringify(DEMO_GPA));
      saveAll(); renderAll();
      showToast(t('toastDemoLoaded'), 'success', 4000);
    });

    /* Credit stepper buttons */
    document.getElementById('btn-decrease-credit')?.addEventListener('click', () => {
      state.targetCredits = Math.max(6, state.targetCredits - 1);
      saveAll(); renderPlannerTab();
    });
    document.getElementById('btn-increase-credit')?.addEventListener('click', () => {
      state.targetCredits = Math.min(32, state.targetCredits + 1);
      saveAll(); renderPlannerTab();
    });
    document.getElementById('target-credit-input')?.addEventListener('change', e => {
      let v = parseFloat(e.target.value) || 16;
      v = Math.max(6, Math.min(32, v));
      state.targetCredits = v;
      e.target.value = v;
      saveAll(); renderPlannerTab();
    });

    /* Auto-plan button */
    document.getElementById('btn-run-auto-plan')?.addEventListener('click', runSmartPlan);

    /* Reset plan button */
    document.getElementById('btn-clear-plan')?.addEventListener('click', async () => {
      const ok = await showConfirm(t('confirmResetPlan'));
      if (!ok) return;
      state.selectedIds = [];
      saveAll(); renderPlannerTab();
      showToast(t('toastPlanReset'), 'info');
    });

    /* ---- Course entry form ---- */
    document.getElementById('course-form')?.addEventListener('submit', e => {
      e.preventDefault();
      hideFormError();

      const code      = document.getElementById('course-code').value.trim();
      const name      = document.getElementById('course-name').value.trim();
      const credits   = parseFloat(document.getElementById('course-credits').value);
      const day       = document.getElementById('course-day').value;
      const startTime = document.getElementById('course-start-time').value;
      const endTime   = document.getElementById('course-end-time').value;
      const isMandatory= document.getElementById('course-is-mandatory').checked;
      const isTight   = document.getElementById('course-is-tight').checked;
      const rating    = parseInt(document.getElementById('course-rating')?.value) || 3;
      const remarks   = document.getElementById('course-remarks').value.trim();

      // Validate (inline errors, no native dialogs)
      if (!code)                        { showFormError(t('errCodeRequired'));   return; }
      if (!name)                        { showFormError(t('errNameRequired'));   return; }
      if (isNaN(credits) || credits < 0.5 || credits > 15) { showFormError(t('errCreditsInvalid')); return; }
      if (timeToMinutes(startTime) >= timeToMinutes(endTime)) { showFormError(t('errTimeInvalid')); return; }

      const existingId = document.getElementById('form-course-id').value;
      const courseData = { code, name, credits, day, startTime, endTime, isMandatory, isTight, rating, remarks };

      if (existingId) {
        // Edit existing course
        const idx = state.courses.findIndex(c => c.id === existingId);
        if (idx !== -1) state.courses[idx] = { id: existingId, ...courseData };
        saveAll(); resetCourseForm(); renderRepoTab(); renderPlannerTab();
        showToast(t('toastUpdated'));
      } else {
        // Add new course
        state.courses.unshift({ id: uid(), ...courseData });
        saveAll(); resetCourseForm(); renderRepoTab(); renderPlannerTab();
        showToast(t('toastAdded'));
      }
    });

    /* Cancel edit */
    document.getElementById('btn-cancel-edit')?.addEventListener('click', resetCourseForm);

    /* ---- GPA form ---- */
    document.getElementById('gpa-form')?.addEventListener('submit', e => {
      e.preventDefault();
      const name    = document.getElementById('gpa-course-name').value.trim();
      const credits = parseFloat(document.getElementById('gpa-course-credits').value);
      const score   = parseFloat(document.getElementById('gpa-course-score').value);

      // Basic validation via toast (no modal for minor form issues)
      if (!name)                        { showToast(t('errGPAName'),    'error'); return; }
      if (isNaN(credits) || credits <= 0) { showToast(t('errGPACredits'), 'error'); return; }
      if (isNaN(score) || score < 0 || score > 100) { showToast(t('errGPAScore'), 'error'); return; }

      state.gpaRecords.unshift({ id: uid(), name, credits, score });
      saveAll();
      document.getElementById('gpa-form').reset();
      renderGPATab();
      showToast(t('toastGPAAdded'));
    });

    /* GPA Target Calculator dynamic inputs */
    document.getElementById('target-gpa-val')?.addEventListener('input', calculateGpaTargetGoal);
    document.getElementById('target-rem-credits')?.addEventListener('input', calculateGpaTargetGoal);

    /* Mobile Timetable Day Swipe Gesture */
    const ttWrapper = document.getElementById('timetable-wrapper');
    if (ttWrapper) {
      let touchStartX = 0, touchStartY = 0;
      ttWrapper.addEventListener('touchstart', e => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      }, { passive: true });
      ttWrapper.addEventListener('touchend', e => {
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;
        // Horizontal swipe detected (dx > 40px and dx significantly larger than dy)
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.4) {
          const days = ['all', '1', '2', '3', '4', '5'];
          const currIdx = days.indexOf(state.activeTimetableDay || 'all');
          if (dx < 0) {
            // Swipe left -> Next day
            const nextIdx = (currIdx + 1) % days.length;
            state.activeTimetableDay = days[nextIdx];
          } else {
            // Swipe right -> Prev day
            const prevIdx = (currIdx - 1 + days.length) % days.length;
            state.activeTimetableDay = days[prevIdx];
          }
          renderTimetable(state.courses.filter(c => state.selectedIds.includes(c.id)));
        }
      }, { passive: true });
    }

    /* ---- Data tab ---- */
    document.getElementById('btn-export-json')?.addEventListener('click', () => {
      const data = {
        version: 2, exportTime: new Date().toISOString(),
        lang: state.lang, theme: state.theme, currentSemesterId: state.currentSemesterId,
        semesters: state.semesters, allSemestersData: state.allSemestersData,
        targetCredits: state.targetCredits,
        selectedIds: state.selectedIds,
        courses: state.courses, gpaRecords: state.gpaRecords
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = Object.assign(document.createElement('a'), {
        href: url, download: `课程规划备份_${new Date().toLocaleDateString('zh-CN').replace(/\//g,'-')}.json`
      });
      a.click();
      URL.revokeObjectURL(url);
      showToast(t('toastExported'));
    });

    document.getElementById('btn-trigger-import')?.addEventListener('click', () => {
      document.getElementById('file-import-json').click();
    });

    document.getElementById('file-import-json')?.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const parsed = JSON.parse(ev.target.result);
          if (!Array.isArray(parsed.courses) && !parsed.allSemestersData) throw new Error('Invalid format');
          if (parsed.semesters && Array.isArray(parsed.semesters)) state.semesters = parsed.semesters;
          if (parsed.allSemestersData) state.allSemestersData = parsed.allSemestersData;
          if (parsed.currentSemesterId) state.currentSemesterId = parsed.currentSemesterId;
          state.courses       = Array.isArray(parsed.courses) ? parsed.courses : [];
          state.selectedIds   = Array.isArray(parsed.selectedIds) ? parsed.selectedIds : [];
          state.targetCredits = parsed.targetCredits || 16;
          state.gpaRecords    = Array.isArray(parsed.gpaRecords) ? parsed.gpaRecords : [];
          saveAll(); renderAll();
          showToast(t('toastImported'), 'success', 4000);
        } catch {
          showToast(t('errImportFailed'), 'error', 5000);
        }
        e.target.value = '';
      };
      reader.readAsText(file);
    });

    document.getElementById('btn-reset-all')?.addEventListener('click', async () => {
      const ok = await showConfirm(t('confirmClearAll'));
      if (!ok) return;
      Object.values(SK).forEach(k => localStorage.removeItem(k));
      state.courses = []; state.selectedIds = [];
      state.targetCredits = 16; state.gpaRecords = [];
      state.semesters = [{ id: 'sem_default', nameZh: '大一 第一学期', nameEn: 'Year 1 Fall Semester', createdAt: Date.now() }];
      state.currentSemesterId = 'sem_default';
      state.allSemestersData = {};
      saveAll(); renderAll();
      showToast(t('toastCleared'), 'info');
    });
  }

  /**
   * Helper: sets data-action on an existing element (for elements that
   * need to work with the delegated click handler but are in the HTML).
   * @param {string} elId
   * @param {string} action
   */
  function bindDataAction(elId, action) {
    const el = document.getElementById(elId);
    if (el) el.setAttribute('data-action', action);
  }

  /* ================================================================
     INIT
  ================================================================ */

  /** Bootstrap the application. */
  async function init() {
    loadAll();
    await IDB.init();
    applyTranslations();
    initListeners();
    renderAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(); // end IIFE
