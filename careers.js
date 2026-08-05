/*
 * Masters School — shared logic for the standalone Careers pages
 * (careers.html, <job>.html and apply-<job>.html).
 *
 * The DC runtime evaluates each page's inline <script data-dc-script> as a
 * class named `Component`, but `DCLogic` only exists after the async React CDN
 * load (see support.js). Shared state, dictionaries, render values and event
 * handlers therefore live here — a plain synchronous script loaded from
 * <head> — and every page just declares:
 *
 *   class Component extends window.MSShared.makeBase(DCLogic) {
 *     static cfg = { mode: "job", slug: "german-teacher", index: 0 };
 *   }
 *
 * Page config (`cfg`):
 *   mode  "list"  -> careers.html          (job listings, each linking to its page)
 *         "job"   -> <slug>.html           (one job posting + Apply -> apply-<slug>.html)
 *         "apply" -> apply-<slug>.html     (the form for exactly that job)
 *   slug  the job's file slug (see SLUGS below)
 *   index the job's position in the `positions` arrays below (0-based)
 *
 * NOTE: SLUGS and the positions arrays must stay in sync with the SPA careers
 * section in index.html — same order, same entries.
 */
(function () {
  'use strict';

  var SLUGS = [
    'german-teacher', 'french-teacher', 'arabic-teacher', 'english-teacher',
    'hr-specialist', 'it-support', 'marketing-officer', 'receptionist',
    'accountant', 'school-nurse', 'administration-officer', 'security',
    'bus-driver', 'bus-supervisor'
  ];

  var DICT = {
    en: {
      brand: { name: 'Masters', tag: 'Language School' },
      nav: { home: 'Home', about: 'About', academics: 'Academics', terms: 'Admission Terms', admissions: 'Admissions', life: 'Student Life', careers: 'Careers', contact: 'Contact', apply: 'Apply Now' },
      top: { portal: "Parents' Portal", hideMenu: 'Hide menu', showMenu: 'Show menu' },
      careers: {
        eyebrow: 'Careers', title: 'Build your career with Masters.', sub: 'Join a team that shapes the future of El Santa — one classroom, one child, one day at a time.',
        perksh: 'Why work with us', perks: [{ t: 'Purpose', d: 'Work that genuinely changes young lives every day.' }, { t: 'Growth', d: 'Ongoing training, mentorship and clear paths to advance.' }, { t: 'Community', d: 'A supportive, family-minded team that has your back.' }, { t: 'Recognition', d: 'Competitive packages and a culture that values great work.' }],
        posh: 'Open positions', possub: "We're hiring across teaching and operations.",
        positions: [
          { r: 'German Teacher', key: 'German Teacher', d: 'Teaching', ty: 'Full-time', desc: 'Teach German to bilingual learners from Kindergarten to Secondary, building fluency and confidence step by step.', resp: ['Plan and deliver engaging German lessons for different age groups', 'Assess student progress and provide regular feedback', 'Collaborate with colleagues to align the language curriculum', 'Foster a love for the language and culture through classes and activities'], qual: ['Degree in German or a relevant education qualification', 'Strong classroom management and communication skills', 'Native or near-native German proficiency'] },
          { r: 'French Teacher', key: 'French Teacher', d: 'Teaching', ty: 'Full-time', desc: 'Teach French to bilingual learners from Kindergarten to Secondary, building fluency and confidence step by step.', resp: ['Plan and deliver engaging French lessons for different age groups', 'Assess student progress and provide regular feedback', 'Collaborate with colleagues to align the language curriculum', 'Foster a love for the language and culture through classes and activities'], qual: ['Degree in French or a relevant education qualification', 'Strong classroom management and communication skills', 'Native or near-native French proficiency'] },
          { r: 'Arabic Teacher', key: 'Arabic Teacher', d: 'Teaching', ty: 'Full-time', desc: 'Teach Arabic to bilingual learners from Kindergarten to Secondary, building fluency and confidence step by step.', resp: ['Plan and deliver engaging Arabic lessons for different age groups', 'Assess student progress and provide regular feedback', 'Collaborate with colleagues to align the language curriculum', 'Foster a love for the language and culture through classes and activities'], qual: ['Degree in Arabic or a relevant education qualification', 'Strong classroom management and communication skills', 'Native or near-native Arabic proficiency'] },
          { r: 'English Teacher', key: 'English Teacher', d: 'Teaching', ty: 'Full-time', desc: 'Teach English to bilingual learners from Kindergarten to Secondary, building fluency and confidence step by step.', resp: ['Plan and deliver engaging English lessons for different age groups', 'Assess student progress and provide regular feedback', 'Collaborate with colleagues to align the language curriculum', 'Foster a love for the language and culture through classes and activities'], qual: ['Degree in English or a relevant education qualification', 'Strong classroom management and communication skills', 'Native or near-native English proficiency'] },
          { r: 'HR Specialist', key: 'HR Specialist', d: 'Human Resources', ty: 'Full-time', desc: 'Run the recruitment cycle end to end and help keep Masters a positive, family-minded place to work.', resp: ['Manage hiring, onboarding and staff records', 'Support payroll inputs and HR policies', 'Coordinate training and staff wellbeing initiatives'], qual: ['Degree in HR or business administration', 'Experience with recruitment and Egyptian labour practices', 'Discreet, organised and people-focused'] },
          { r: 'IT Support Engineer', key: 'IT Support', d: 'IT', ty: 'Full-time', desc: 'Keep classrooms, labs and offices running on reliable and secure technology every school day.', resp: ['Maintain networks, devices and smart-classroom systems', 'Resolve staff and student technical issues quickly', 'Support the admissions and administration platforms'], qual: ['Degree or diploma in IT or computer science', 'Hands-on experience with networks and user support', 'Calm, methodical troubleshooting under time pressure'] },
          { r: 'Marketing Officer', key: 'Marketing Officer', d: 'Marketing', ty: 'Full-time', desc: 'Grow the Masters brand through campaigns, content and community outreach across El Santa and Gharbia.', resp: ['Plan and run digital and offline campaigns', 'Create engaging content and manage social media', 'Organise open days and community events'], qual: ['Degree in marketing or communications', 'Hands-on social media and content experience', 'Creative, organised and fluent in English and Arabic'] },
          { r: 'Receptionist', key: 'Receptionist', d: 'Administration', ty: 'Full-time', desc: 'Be the warm first impression of Masters — greeting families and keeping the front office running smoothly.', resp: ['Welcome visitors and answer calls professionally', 'Handle parent enquiries and appointment scheduling', 'Support day-to-day office administration'], qual: ['Excellent communication and presentation skills', 'Customer-service experience', 'Computer literacy and close attention to detail'] },
          { r: 'Accountant', key: 'Accountant', d: 'Finance', ty: 'Full-time', desc: "Keep the school's finances accurate and transparent — from tuition records to monthly reporting.", resp: ['Process fees, invoices and payments', 'Maintain ledgers and reconcile accounts', 'Prepare monthly financial reports'], qual: ['Degree in accounting or finance', 'Experience with Egyptian accounting standards', 'Strong Excel skills and high accuracy'] },
          { r: 'School Nurse', key: 'Nurse', d: 'Health', ty: 'Full-time', desc: "Care for students' health and safety on campus, from first aid to health records.", resp: ['Provide first aid and daily health care', 'Maintain student health records', 'Support health awareness programmes with staff'], qual: ['Nursing degree and a valid licence', 'Paediatric or school-health experience', 'Calm, caring and observant'] },
          { r: 'Administration Officer', key: 'Administration', d: 'Administration', ty: 'Full-time', desc: 'Coordinate school operations and support the leadership team with organised, reliable administration.', resp: ['Manage schedules, records and correspondence', 'Coordinate with departments and parents', 'Support events and daily operations'], qual: ['Degree in administration or equivalent', 'Strong organisation and planning skills', 'Proficiency in office software'] },
          { r: 'Security Personnel', key: 'Security', d: 'Security', ty: 'Full-time', desc: 'Protect students, staff and the campus, helping keep the school safe and welcoming.', resp: ['Control site access and monitor the campus', 'Respond quickly to any safety incident', 'Support student arrival and dismissal routines'], qual: ['Previous security or military service is preferred', 'Good judgement and professionalism', 'Able to work school-day shifts'] },
          { r: 'Bus Drivers', key: 'Bus Driver', d: 'Transport', ty: 'Full-time', desc: 'Transport students safely on fixed routes across El Santa and nearby areas, every school day.', resp: ['Drive school buses on assigned routes safely', 'Follow schedules and complete pre-trip safety checks', 'Report vehicle issues promptly'], qual: ["Valid driver's licence and a clean record", 'Experience driving large vehicles', 'Patient, punctual and safety-focused'] },
          { r: 'Bus Supervisors', key: 'Bus Supervisor', d: 'Transport', ty: 'Full-time', desc: 'Look after students during bus journeys and coordinate smoothly with drivers and parents.', resp: ['Supervise students on board at all times', 'Maintain route rosters and attendance records', 'Communicate updates to parents and the school'], qual: ['Experience caring for children in a similar role', 'Responsible and alert', 'Good communication skills'] }
        ],
        apply: 'Apply', formh: 'Application form', formsub: 'Tell us about yourself', applybtn: 'Apply for this position', jobeyebrow: 'Careers at Masters', jobh: 'About the role', resph: 'Main responsibilities', qualh: 'Required qualifications', jobback: 'Back to all positions', back: 'Back', tyLabel: 'Employment type', locLabel: 'Location', loc: 'El Santa, Gharbia Governorate, Egypt', applying: 'Complete the form below to apply for this position. Our HR team will review your application and contact shortlisted candidates.', ptitle: 'Careers — Masters Language School', footernote: 'Have a question before applying? Chat with our team on WhatsApp.', contactbtn: 'Chat on WhatsApp',
        f: { personal: 'Personal information', name: 'Full name', phone: 'Phone number', email: 'Email address', position: 'Position applying for', exp: 'Experience & education', years: 'Years of experience', edu: 'Highest qualification', docs: 'Documents', cv: 'CV / Résumé', cert: 'Certificates', portfolio: 'Portfolio (optional)', upload: 'Upload file', submit: 'Submit application', sending: 'Sending…', required: 'Fields marked * are required.' },
        conf: { h: 'Thank you for applying!', sub: 'Our HR team will review your application and contact shortlisted candidates within 5 working days.', idlabel: 'Your reference number', note: 'A confirmation email has been sent to you.' }
      },
      foot: {
        about: 'A leading bilingual language school in El Santa, Gharbia — shaping curious, confident and compassionate learners since 2026.',
        explore: 'Explore', admissions: 'Admissions', contactc: 'Contact us',
        rights: '© 2026 Masters Language School. All rights reserved.',
        addr: 'El Santa, Gharbia Governorate, Egypt', phone: '+20 109 978 7423', email: 'masterschool59@gmail.com'
      }
    },
    ar: {
      brand: { name: 'ماسترز', tag: 'مدرسة اللغات' },
      nav: { home: 'الرئيسية', about: 'عن المدرسة', academics: 'البرامج الأكاديمية', terms: 'شروط التقديم', admissions: 'القبول والتسجيل', life: 'الحياة الطلابية', careers: 'الوظائف', contact: 'اتصل بنا', apply: 'قدّم الآن' },
      top: { portal: 'بوابة أولياء الأمور', hideMenu: 'إخفاء القائمة', showMenu: 'إظهار القائمة' },
      careers: {
        eyebrow: 'الوظائف', title: 'ابنِ مستقبلك المهني مع ماسترز.', sub: 'انضمّ لفريقٍ يصنع مستقبل السنطة — فصلًا بعد فصل، وطفلًا بعد طفل.',
        perksh: 'لماذا تعمل معنا', perks: [{ t: 'المعنى', d: 'عملٌ يغيّر حياة النشء كل يوم بحق.' }, { t: 'النموّ', d: 'تدريب مستمر وإرشاد ومسارات واضحة للترقّي.' }, { t: 'المجتمع', d: 'فريقٌ داعمٌ بروح العائلة يسندك دائمًا.' }, { t: 'التقدير', d: 'حزم رواتب تنافسية وثقافة تقدّر العمل المتميّز.' }],
        posh: 'الوظائف المتاحة', possub: 'نوظّف في التدريس والتشغيل.',
        positions: [
          { r: 'معلم لغة ألمانية', key: 'معلم لغة ألمانية', d: 'التدريس', ty: 'دوام كامل', desc: 'تدريس اللغة الألمانية لطلاب ثنائيي اللغة من الروضة حتى الثانوية، مع بناء الطلاقة والثقة خطوة بخطوة.', resp: ['إعداد دروس مشوّقة في الألمانية لمختلف الفئات العمرية', 'تقييم تقدم الطلاب وتقديم تغذية راجعة منتظمة', 'التعاون مع الزملاء في مواءمة مناهج اللغات', 'تعزيز حب اللغة والثقافة من خلال الدروس والأنشطة'], qual: ['مؤهل في اللغة الألمانية أو مؤهل تربوي ذي صلة', 'مهارات قوية في إدارة الصف والتواصل', 'طلاقة أصلية أو شبه أصلية في الألمانية'] },
          { r: 'معلم لغة فرنسية', key: 'معلم لغة فرنسية', d: 'التدريس', ty: 'دوام كامل', desc: 'تدريس اللغة الفرنسية لطلاب ثنائيي اللغة من الروضة حتى الثانوية، مع بناء الطلاقة والثقة خطوة بخطوة.', resp: ['إعداد دروس مشوّقة في الفرنسية لمختلف الفئات العمرية', 'تقييم تقدم الطلاب وتقديم تغذية راجعة منتظمة', 'التعاون مع الزملاء في مواءمة مناهج اللغات', 'تعزيز حب اللغة والثقافة من خلال الدروس والأنشطة'], qual: ['مؤهل في اللغة الفرنسية أو مؤهل تربوي ذي صلة', 'مهارات قوية في إدارة الصف والتواصل', 'طلاقة أصلية أو شبه أصلية في الفرنسية'] },
          { r: 'معلم لغة عربية', key: 'معلم لغة عربية', d: 'التدريس', ty: 'دوام كامل', desc: 'تدريس اللغة العربية لطلاب ثنائيي اللغة من الروضة حتى الثانوية، مع بناء الطلاقة والثقة خطوة بخطوة.', resp: ['إعداد دروس مشوّقة في العربية لمختلف الفئات العمرية', 'تقييم تقدم الطلاب وتقديم تغذية راجعة منتظمة', 'التعاون مع الزملاء في مواءمة مناهج اللغات', 'تعزيز حب اللغة والثقافة من خلال الدروس والأنشطة'], qual: ['مؤهل في اللغة العربية أو مؤهل تربوي ذي صلة', 'مهارات قوية في إدارة الصف والتواصل', 'طلاقة أصلية أو شبه أصلية في العربية'] },
          { r: 'معلم لغة إنجليزية', key: 'معلم لغة إنجليزية', d: 'التدريس', ty: 'دوام كامل', desc: 'تدريس اللغة الإنجليزية لطلاب ثنائيي اللغة من الروضة حتى الثانوية، مع بناء الطلاقة والثقة خطوة بخطوة.', resp: ['إعداد دروس مشوّقة للإنجليزية لمختلف الفئات العمرية', 'تقييم تقدم الطلاب وتقديم تغذية راجعة منتظمة', 'التعاون مع الزملاء في مواءمة مناهج اللغات', 'تعزيز حب اللغة والثقافة من خلال الدروس والأنشطة'], qual: ['مؤهل في اللغة الإنجليزية أو مؤهل تربوي ذي صلة', 'مهارات قوية في إدارة الصف والتواصل', 'طلاقة أصلية أو شبه أصلية في الإنجليزية'] },
          { r: 'أخصائي موارد بشرية', key: 'أخصائي موارد بشرية', d: 'الموارد البشرية', ty: 'دوام كامل', desc: 'إدارة دورة التوظيف من البداية إلى النهاية ودعم بيئة عمل إيجابية بروح العائلة في ماسترز.', resp: ['إدارة التوظيف والتعيين وسجلات الموظفين', 'دعم مدخلات الرواتب وسياسات الموارد البشرية', 'تنسيق التدريب ومبادرات رفاهية الموظفين'], qual: ['مؤهل في الموارد البشرية أو إدارة الأعمال', 'خبرة في التوظيف وقوانين العمل المصرية', 'السرية والتنظيم والتركيز على الناس'] },
          { r: 'مهندس دعم تقني', key: 'دعم تقني', d: 'تكنولوجيا المعلومات', ty: 'دوام كامل', desc: 'إبقاء الفصول والمختبرات والمكاتب تعمل بتقنية موثوقة وآمنة طوال أيام الدراسة.', resp: ['صيانة الشبكات والأجهزة وأنظمة الفصول الذكية', 'حل مشكلات التقنية للموظفين والطلاب بسرعة', 'دعم منصات القبول والإدارة'], qual: ['مؤهل في تقنية المعلومات أو علوم الحاسب', 'خبرة عملية في الشبكات ودعم المستخدمين', 'هدوء ودراسة منهجية للمشكلات تحت الضغط'] },
          { r: 'مسؤول تسويق', key: 'مسؤول تسويق', d: 'التسويق', ty: 'دوام كامل', desc: 'تنمية علامة ماسترز من خلال الحملات والمحتوى والتواصل المجتمعي في السنطة والغربية.', resp: ['تخطيط وتنفيذ حملات رقمية وتقليدية', 'إنشاء محتوى جذاب وإدارة وسائل التواصل', 'تنظيم الأيام المفتوحة والفعاليات المجتمعية'], qual: ['مؤهل في التسويق أو الإعلام', 'خبرة عملية في وسائل التواصل والمحتوى', 'إبداع وتنظيم وإتقان الإنجليزية والعربية'] },
          { r: 'موظف استقبال', key: 'موظف استقبال', d: 'الإدارة', ty: 'دوام كامل', desc: 'أن تكون الانطباع الأول الدافئ لطلاب ماسترز — استقبال العائلات وإدارة مكتب الاستقبال بسلاسة.', resp: ['استقبال الزوار والرد على الاتصالات باحترافية', 'التعامل مع استفسارات أولياء الأمور وجدولة المواعيد', 'دعم المهام الإدارية المكتبية'], qual: ['مهارات تواصل ومظهر احترافي', 'خبرة في خدمة العملاء', 'إلمام بالحاسب والاهتمام الدقيق بالتفاصيل'] },
          { r: 'محاسب', key: 'محاسب', d: 'الحسابات', ty: 'دوام كامل', desc: 'الحفاظ على دقة وشفافية مالية المدرسة — من سجلات الرسوم إلى التقارير الشهرية.', resp: ['معالجة الرسوم والفواتير والمدفوعات', 'إمساك الدفاتر وتسوية الحسابات', 'إعداد التقارير المالية الشهرية'], qual: ['مؤهل في المحاسبة أو المالية', 'خبرة في المعايير المحاسبية المصرية', 'إتقان الإكسل والدقة العالية'] },
          { r: 'ممرضة مدرسية', key: 'ممرضة', d: 'الصحة', ty: 'دوام كامل', desc: 'العناية بصحة وسلامة الطلاب في المدرسة — من الإسعافات الأولية إلى السجلات الصحية.', resp: ['تقديم الإسعافات والرعاية الصحية اليومية', 'صيانة السجلات الصحية للطلاب', 'دعم برامج التوعية الصحية مع الموظفين'], qual: ['مؤهل تمريض ورخصة سارية', 'خبرة في صحة الأطفال أو الصحة المدرسية', 'هدوء ورعاية وملاحظة دقيقة'] },
          { r: 'موظف إداري', key: 'موظف إداري', d: 'الإدارة', ty: 'دوام كامل', desc: 'تنسيق عمليات المدرسة ودعم فريق القيادة بإدارة مكتبية منظمة وموثوقة.', resp: ['إدارة الجداول والسجلات والمراسلات', 'التنسيق بين الأقسام وأولياء الأمور', 'دعم الفعاليات والعمليات اليومية'], qual: ['مؤهل في الإدارة أو ما يعادله', 'مهارات تنظيم وتخطيط قوية', 'إتقان برامج المكتب'] },
          { r: 'أفراد أمن', key: 'أمن', d: 'الأمن', ty: 'دوام كامل', desc: 'حماية الطلاب والموظفين ومرافق المدرسة والحفاظ على بيئة آمنة ومرحّبة.', resp: ['التحكم في دخول الموقع ومراقبة المدرسة', 'الاستجابة السريعة لأي حادث سلامة', 'دعم إجراءات الحضور والانصراف'], qual: ['خبرة أمنية أو عسكرية سابقة ميزة', 'حكمة جيدة واحترافية', 'القدرة على العمل بنوبات اليوم الدراسي'] },
          { r: 'سائقو حافلات', key: 'سائق حافلة', d: 'النقل', ty: 'دوام كامل', desc: 'نقل الطلاب بأمان على مسارات ثابتة في السنطة والمناطق المجاورة طوال أيام الدراسة.', resp: ['قيادة حافلات المدرسة على المسارات المحددة بأمان', 'الالتزام بالجداول وإجراء الفحوصات قبل الانطلاق', 'الإبلاغ الفوري عن أي أعطال في المركبة'], qual: ['رخصة قيادة سارية وسجل نظيف', 'خبرة في قيادة المركبات الكبيرة', 'صبر والالتزام بالمواعيد والسلامة'] },
          { r: 'مشرفو حافلات', key: 'مشرف حافلة', d: 'النقل', ty: 'دوام كامل', desc: 'الاعتناء بالطلاب أثناء رحلات الحافلة والتنسيق بسلاسة مع السائقين وأولياء الأمور.', resp: ['الإشراف على الطلاب طوال الرحلة', 'صيانة جداول المسارات وسجلات الحضور', 'إبلاغ أولياء الأمور والمدرسة بالتحديثات'], qual: ['خبرة في رعاية الأطفال في دور مشابه', 'مسؤولية ويقظة دائمة', 'مهارات تواصل جيدة'] }
        ],
        apply: 'تقديم', formh: 'نموذج التقديم', formsub: 'عرّفنا بنفسك', applybtn: 'تقدّم لهذه الوظيفة', jobeyebrow: 'وظائف ماسترز', jobh: 'عن الوظيفة', resph: 'المسؤوليات الرئيسية', qualh: 'المؤهلات المطلوبة', jobback: 'العودة إلى كل الوظائف', back: 'رجوع', tyLabel: 'نوع الوظيفة', locLabel: 'الموقع', loc: 'السنطة، محافظة الغربية، مصر', applying: 'أكمل النموذج أدناه للتقديم على هذه الوظيفة. سيراجع فريق الموارد البشرية طلبك وسيتواصل مع المرشحين المختارين.', ptitle: 'الوظائف — مدرسة ماسترز للغات', footernote: 'لديك سؤال قبل التقديم؟ تحدّث مع فريقنا عبر واتساب.', contactbtn: 'تواصل عبر واتساب',
        f: { personal: 'البيانات الشخصية', name: 'الاسم بالكامل', phone: 'رقم الهاتف', email: 'البريد الإلكتروني', position: 'الوظيفة المتقدَّم لها', exp: 'الخبرة والتعليم', years: 'سنوات الخبرة', edu: 'أعلى مؤهل', docs: 'المستندات', cv: 'السيرة الذاتية', cert: 'الشهادات', portfolio: 'معرض الأعمال (اختياري)', upload: 'رفع ملف', submit: 'إرسال الطلب', sending: 'جارٍ الإرسال…', required: 'الحقول المعلّمة بـ * مطلوبة.' },
        conf: { h: 'شكرًا لتقديمك!', sub: 'سيراجع فريق الموارد البشرية طلبك ويتواصل مع المرشحين خلال 5 أيام عمل.', idlabel: 'رقمك المرجعي', note: 'تم إرسال بريد تأكيد إليك.' }
      },
      foot: {
        about: 'مدرسة لغات ثنائية رائدة في السنطة، الغربية — نصنع متعلّمين فضوليين واثقين ومتعاطفين منذ 2026.',
        explore: 'استكشف', admissions: 'القبول', contactc: 'تواصل معنا',
        rights: '© 2026 مدرسة ماسترز للغات. جميع الحقوق محفوظة.',
        addr: 'السنطة، محافظة الغربية، مصر', phone: '+20 109 978 7423', email: 'masterschool59@gmail.com'
      }
    }
  };

  function makeBase(DCLogic) {
    return class CareersPage extends DCLogic {
      state = { lang: 'en', navOpen: true, careerSubmitted: false, careerId: '', careerSending: false, careerSendError: '' };

      cfg() {
        return (this.constructor && this.constructor.cfg) || { mode: 'list' };
      }
      content() { return DICT; }
      currentJob() {
        const idx = this.cfg().index;
        if (idx === undefined || idx === null) return null;
        return this.content()[this.state.lang].careers.positions[idx] || null;
      }
      backHref() {
        const cfg = this.cfg();
        return cfg.mode === 'apply' ? (cfg.slug || '') + '.html' : 'careers.html';
      }
      scrollTop() { try { window.scrollTo(0, 0); } catch (e) {} }
      toggleLang() {
        const next = this.state.lang === 'en' ? 'ar' : 'en';
        this.applyDocLang(next);
        this.setState({ lang: next });
      }
      applyDocLang(lang) {
        try {
          const el = document.documentElement;
          el.setAttribute('lang', lang);
          el.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
          document.title = this.docTitle(this.content()[lang]);
        } catch (e) {}
      }
      docTitle(t) {
        const cfg = this.cfg();
        if (cfg.mode === 'list') return t.careers.ptitle;
        const job = cfg.index !== undefined && cfg.index !== null
          ? t.careers.positions[cfg.index] : null;
        if (job) return job.r + ' — ' + t.brand.name + ' ' + t.brand.tag;
        return t.brand.name + ' ' + t.brand.tag;
      }
      toggleNav() { this.setState({ navOpen: !this.state.navOpen }); }

      // Fallback reference shown only in demo mode (no careersEndpoint
      // configured) — mirrors the admissions form's localId() so an
      // unconfigured deployment stays usable but never claims a real save.
      careerLocalId() { return 'MST-HR-' + Math.floor(1000 + Math.random() * 9000); }

      careersEndpoint() {
        return (typeof window !== 'undefined' && window.MS_CONFIG && window.MS_CONFIG.careersEndpoint) || '';
      }

      submitCareer(e) {
        if (e && e.preventDefault) e.preventDefault();
        const form = e && e.target;
        const url = this.careersEndpoint();

        if (!url) {
          // No backend wired up yet — keep the flow usable but never claim
          // it was actually sent anywhere (same rationale as the admissions
          // form's demo mode).
          try {
            console.warn('[Masters] DEMO MODE: no careersEndpoint configured, so this ' +
              'application was NOT saved or emailed. Configure window.MS_CONFIG.careersEndpoint.');
          } catch (err) {}
          this.setState({ careerSubmitted: true, careerId: this.careerLocalId(), careerSending: false, careerSendError: '' });
          this.scrollTop();
          return;
        }

        if (!form) return;
        this.setState({ careerSending: true, careerSendError: '' });

        const xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        xhr.setRequestHeader('Accept', 'application/json');
        xhr.timeout = 120000;

        const fail = (msg) => this.setState({ careerSending: false, careerSubmitted: false, careerSendError: String(msg) });

        xhr.onload = () => {
          let data = {};
          try { data = JSON.parse(xhr.responseText || '{}'); } catch (err) {}
          if (xhr.status >= 200 && xhr.status < 300) {
            this.setState({
              careerSending: false, careerSubmitted: true, careerSendError: '',
              careerId: (data && data.careerId) || this.careerLocalId(),
            });
            this.scrollTop();
          } else {
            // Never show a success screen for a submission that failed.
            fail((data && data.error) || ('HTTP ' + xhr.status));
          }
        };
        xhr.onerror = () => fail('network error');
        xhr.ontimeout = () => fail('timeout');
        xhr.send(new FormData(form));
      }
      renderVals() {
        const t = this.content()[this.state.lang];
        const cfg = this.cfg();
        const job = this.currentJob();
        const rows = t.careers.positions.map(function (p, i) {
          return { r: p.r, d: p.d, ty: p.ty, href: SLUGS[i] + '.html' };
        });
        return {
          t: t,
          lang: this.state.lang,
          dir: this.state.lang === 'ar' ? 'rtl' : 'ltr',
          langLabel: this.state.lang === 'en' ? 'العربية' : 'English',
          navOpen: this.state.navOpen,
          toggleLang: () => this.toggleLang(),
          toggleNav: () => this.toggleNav(),
          navToggleLabel: this.state.navOpen ? t.top.hideMenu : t.top.showMenu,
          navArrowStyle: 'transition:transform .25s ease;transform:rotate(' + (this.state.navOpen ? '180' : '0') + 'deg)',
          navPanelStyle: this.state.navOpen
            ? 'display:flex;align-items:center;gap:1px;overflow:hidden;max-height:220px;opacity:1;transform:translateY(0);visibility:visible;transition:max-height .35s ease,opacity .3s ease,transform .3s ease,visibility .3s'
            : 'display:flex;align-items:center;gap:1px;overflow:hidden;max-height:0;opacity:0;transform:translateY(-6px);visibility:hidden;transition:max-height .35s ease,opacity .3s ease,transform .3s ease,visibility .3s',
          careersRows: rows,
          backHref: this.backHref(),
          jobTitle: job ? job.r : '',
          jobDept: job ? job.d : '',
          jobType: job ? job.ty : '',
          jobLoc: t.careers.loc,
          jobDesc: job ? job.desc : '',
          jobResp: job ? job.resp : [],
          jobQual: job ? job.qual : [],
          applyHref: cfg.mode === 'list' ? '' : 'apply-' + (cfg.slug || '') + '.html',
          positionKey: job ? job.key : '',
          careerSubmitted: this.state.careerSubmitted,
          careerNot: !this.state.careerSubmitted,
          careerId: this.state.careerId,
          careerSending: this.state.careerSending,
          careerSubmitLabel: this.state.careerSending ? (t.careers.f.sending || 'Sending…') : t.careers.f.submit,
          hasCareerSendError: !!this.state.careerSendError,
          careerSendError: this.state.careerSendError,
          submitCareer: (e) => this.submitCareer(e)
        };
      }
    };
  }

  window.MSShared = { SLUGS: SLUGS, DICT: DICT, makeBase: makeBase };
})();
