/**
 * Best-effort lowercase word segmentation, used when the AI emits a glued
 * lowercase string with no internal case / digit / punctuation boundaries
 * for the regex splitter to grab. We can't use a full corpus segmenter
 * like wordninja in the browser bundle (its dictionary is ~1 MB), so this
 * file ships a hand-curated set of the most common English words plus
 * domain words that show up in our generated templates (finance, medical,
 * e-commerce). ~600 entries, ~3 KB after gzip.
 *
 * Algorithm: dynamic-programming maximum-score segmentation.
 * Each candidate word gets a score = length² (longer matches preferred so
 * "thankyou" prefers "thank" + "you" over "t" + "hank" + "you" if both
 * "hank" and "thank" are in the dict — though "hank" isn't here on
 * purpose). Words shorter than 2 chars are not allowed except `a` and
 * `i` (the only two valid 1-letter English words). If no segmentation
 * uses every character via known words, the original string is returned
 * unchanged so we never produce gibberish.
 */

const DICT: ReadonlySet<string> = new Set([
  // 1-letter words (the only two)
  'a', 'i',
  // top high-frequency English words
  'the', 'be', 'to', 'of', 'and', 'in', 'that', 'have', 'it', 'for',
  'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at', 'this', 'but',
  'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she', 'or', 'an',
  'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what', 'so', 'up',
  'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me', 'when', 'make',
  'can', 'like', 'time', 'no', 'just', 'him', 'know', 'take', 'people', 'into',
  'year', 'your', 'good', 'some', 'could', 'them', 'see', 'other', 'than', 'then',
  'now', 'look', 'only', 'come', 'its', 'over', 'think', 'also', 'back', 'after',
  'use', 'two', 'how', 'our', 'work', 'first', 'well', 'way', 'even', 'new',
  'want', 'because', 'any', 'these', 'give', 'day', 'most', 'us', 'is', 'are',
  'was', 'were', 'been', 'has', 'had', 'did', 'does', 'doing', 'should', 'must',
  'may', 'might', 'shall', 'such', 'every', 'each', 'where', 'while', 'before', 'until',
  'between', 'against', 'among', 'around', 'through', 'during', 'without', 'within', 'above', 'below',
  'under', 'across', 'along', 'beyond', 'inside', 'outside', 'upon', 'unto', 'per', 'via',
  // common verbs / adjectives / nouns
  'thank', 'thanks', 'order', 'shop', 'product', 'item', 'items', 'list', 'date', 'name',
  'address', 'number', 'amount', 'total', 'subtotal', 'grand', 'tax', 'shipping', 'price', 'unit',
  'quantity', 'description', 'note', 'notes', 'detail', 'details', 'summary', 'invoice', 'receipt', 'customer',
  'company', 'business', 'service', 'services', 'product', 'products', 'discount', 'offer', 'fee', 'fees',
  'rate', 'percent', 'percentage', 'monthly', 'annual', 'yearly', 'weekly', 'daily', 'rupees', 'dollars',
  'currency', 'value', 'cost', 'pay', 'paid', 'payment', 'payments', 'method', 'card', 'credit',
  'debit', 'cash', 'cheque', 'check', 'bank', 'account', 'balance', 'loan', 'lender', 'borrower',
  'interest', 'principal', 'tenure', 'term', 'duration', 'months', 'years', 'days', 'period', 'maturity',
  'fixed', 'floating', 'variable', 'emi', 'installment', 'penalty', 'late', 'processing', 'origination', 'closing',
  'kfs', 'fact', 'statement', 'disclaimer', 'agreement', 'contract', 'terms', 'conditions', 'binding', 'legal',
  'legally', 'understanding', 'mou', 'memorandum', 'between', 'party', 'parties', 'signature', 'signed', 'witness',
  'effective', 'date', 'expiry', 'expiration', 'valid', 'validity', 'renewal', 'amendment', 'consent', 'authorized',
  // medical
  'patient', 'doctor', 'hospital', 'clinic', 'medical', 'medicine', 'medication', 'medications', 'prescription', 'rx',
  'dose', 'dosage', 'frequency', 'tablet', 'capsule', 'syrup', 'injection', 'mg', 'ml', 'drop',
  'drops', 'twice', 'thrice', 'three', 'four', 'times', 'once', 'daily', 'weekly', 'morning',
  'evening', 'night', 'before', 'after', 'meals', 'food', 'water', 'empty', 'stomach', 'symptom',
  'symptoms', 'improve', 'avoid', 'alcohol', 'smoking', 'caffeine', 'rest', 'exercise', 'follow', 'up',
  'consult', 'consultation', 'consultant', 'visit', 'check', 'review', 'physician', 'surgeon', 'specialist', 'nurse',
  'admission', 'discharge', 'mrn', 'history', 'diagnosis', 'final', 'condition', 'treatment', 'given', 'instructions',
  'instruction', 'reaction', 'reactions', 'adverse', 'side', 'effect', 'effects', 'allergy', 'allergic', 'report',
  'reactions', 'immediately', 'completion', 'complete', 'course', 'antibiotic', 'antibiotics', 'painkiller', 'gender', 'age',
  'male', 'female', 'old', 'young', 'years', 'weight', 'height', 'blood', 'pressure', 'pulse',
  'temperature', 'sugar', 'cholesterol', 'reg', 'registration', 'license', 'qualification', 'mbbs', 'md', 'phd',
  'take', 'taken', 'taking', 'prescribed',
  // e-commerce
  'shop', 'store', 'cart', 'checkout', 'order', 'orders', 'delivery', 'delivered', 'shipping', 'shipped',
  'tracking', 'package', 'pack', 'item', 'items', 'sku', 'gst', 'vat', 'gstn', 'tin',
  'pan', 'aadhaar', 'mobile', 'phone', 'email', 'website', 'web', 'online', 'offline', 'pickup',
  'return', 'refund', 'exchange', 'warranty', 'guarantee', 'review', 'rating', 'feedback', 'support', 'help',
  'help', 'desk', 'contact', 'us', 'about', 'home', 'login', 'logout', 'register', 'signup',
  'profile', 'settings', 'wishlist', 'favorite', 'favorites', 'category', 'categories', 'brand', 'brands', 'sale',
  'sales', 'offer', 'offers', 'coupon', 'coupons', 'voucher', 'gift', 'reward', 'loyalty', 'points',
  // common short words
  'is', 'as', 'an', 'at', 'be', 'by', 'do', 'go', 'he', 'if',
  'in', 'it', 'me', 'my', 'no', 'of', 'on', 'or', 'so', 'to',
  'up', 'us', 'we', 'rs', 'inr', 'usd', 'eur', 'gbp',
  // commonly-missing fillers caught during testing
  'full', 'half', 'part', 'parts', 'whole', 'end', 'ends', 'ending',
  'finish', 'finished', 'start', 'started', 'starting', 'begin', 'began', 'begun',
  'completion', 'completed', 'completing', 'fully', 'partial', 'partially',
  'thereof', 'therein', 'hereby', 'hereto', 'hereof', 'thereto',
  'shall', 'whether', 'wherever', 'whenever', 'however', 'whoever', 'whatever',
  'made', 'making', 'sent', 'sending', 'received', 'receiving',
  'apply', 'applied', 'applying', 'application', 'applicable',
  'required', 'requires', 'requiring', 'requirement', 'requirements',
  'including', 'included', 'includes', 'inclusive', 'exclude', 'excluded', 'excluding',
  'available', 'unavailable', 'open', 'opened', 'closed', 'closing',
  'subject', 'subjects', 'object', 'objects', 'goods',
  'right', 'left', 'centre', 'center', 'middle',
  'addresses', 'postal', 'pin', 'zip',
  'city', 'town', 'country', 'india', 'usa', 'uk', 'eu',
  // ── HR / Employee handbook ───────────────────────────────────────
  'employee', 'employees', 'employer', 'employment', 'employed', 'employing',
  'handbook', 'handbooks', 'manual', 'guide', 'guidelines', 'guideline', 'policy', 'policies',
  'procedure', 'procedures', 'process', 'processes', 'standard', 'standards',
  'mission', 'vision', 'values', 'core', 'culture', 'cultural',
  'integrity', 'innovation', 'teamwork', 'excellence', 'respect', 'responsibility',
  'accountability', 'commitment', 'committed', 'dedicated', 'dedication',
  'organization', 'organisation', 'organizational', 'structure', 'department', 'departments',
  'team', 'teams', 'group', 'groups', 'division', 'divisions', 'unit', 'units',
  'role', 'roles', 'position', 'positions', 'title', 'titles', 'designation',
  'manager', 'managers', 'supervisor', 'supervisors', 'lead', 'leads', 'leader', 'leaders',
  'analyst', 'engineer', 'engineers', 'developer', 'developers', 'designer',
  'junior', 'senior', 'principal', 'staff', 'intern', 'associate', 'executive', 'director',
  'salary', 'salaries', 'wage', 'wages', 'compensation', 'package', 'packages',
  'bonus', 'bonuses', 'incentive', 'incentives', 'commission', 'allowance', 'allowances',
  'band', 'bands', 'grade', 'grades', 'level', 'levels', 'tier', 'tiers',
  'minimum', 'maximum', 'min', 'max', 'range', 'ranges',
  'benefit', 'benefits', 'health', 'healthcare', 'insurance', 'medical',
  'retirement', 'pension', 'gratuity', 'provident', 'fund',
  'vacation', 'holiday', 'holidays', 'leave', 'leaves', 'sick', 'casual', 'parental', 'maternity', 'paternity',
  'annual', 'monthly', 'weekly', 'daily', 'hourly', 'overtime',
  'attendance', 'absent', 'absence', 'present', 'punctuality',
  'working', 'hours', 'shift', 'shifts', 'schedule', 'schedules', 'roster',
  'lunch', 'tea', 'coffee', 'meal', 'meals', 'recess',
  'conduct', 'misconduct', 'behavior', 'behaviour', 'ethics', 'ethical', 'moral',
  'compliance', 'comply', 'compliant', 'compliances', 'regulation', 'regulations',
  'law', 'laws', 'lawful', 'unlawful', 'illegal', 'legal',
  'rule', 'rules', 'regulation', 'standard', 'norm', 'norms',
  'harassment', 'discrimination', 'retaliation', 'bullying', 'abuse', 'abusive',
  'prohibited', 'prohibition', 'forbidden', 'restricted', 'restriction',
  'permitted', 'allowed', 'permission', 'authorized', 'authorization',
  'confidential', 'confidentiality', 'proprietary', 'protect', 'protection',
  'insider', 'trading', 'sharing', 'public', 'private', 'nonpublic',
  'reporting', 'report', 'reports', 'reported', 'reportable',
  'violation', 'violations', 'breach', 'breaches', 'penalty', 'penalties',
  'communication', 'email', 'slack', 'meeting', 'meetings', 'message', 'messages',
  'professional', 'unprofessional', 'courteous', 'respectful',
  'security', 'secure', 'password', 'passwords', 'access', 'accessing', 'login', 'logout',
  'data', 'database', 'server', 'system', 'systems', 'network', 'networks',
  'device', 'devices', 'laptop', 'desktop', 'mobile', 'phone',
  'performance', 'review', 'reviews', 'evaluation', 'evaluations', 'appraisal', 'appraisals',
  'rating', 'ratings', 'score', 'scores', 'feedback',
  'meets', 'exceeds', 'expectation', 'expectations', 'outstanding', 'satisfactory', 'unsatisfactory',
  'grievance', 'grievances', 'complaint', 'complaints', 'dispute', 'disputes',
  'resolution', 'resolve', 'mediation', 'arbitration',
  'step', 'steps', 'workflow', 'escalation', 'escalate',
  'contact', 'reach', 'inform', 'notify', 'notification',
  'acknowledgment', 'acknowledgement', 'acknowledge', 'acknowledged',
  'agree', 'agreed', 'agreement', 'consent', 'sign', 'signed', 'signature', 'signatures',
  'received', 'read', 'understood', 'abide', 'abiding',
  'outlined', 'outlined', 'specified', 'mentioned', 'detailed', 'described',
  'therein', 'thereto', 'hereunder', 'herewith',
  // ── Finance / Banking ────────────────────────────────────────────
  'thrilled', 'welcome', 'welcoming', 'welcomed',
  'foster', 'fostering', 'collaboration', 'collaborate', 'collaborative',
  'growth', 'growing', 'innovation', 'innovate', 'innovative',
  'success', 'successful', 'successfully', 'journey', 'together',
  'questions', 'question', 'answer', 'answers', 'response', 'responses',
  'forward', 'backward', 'ahead', 'behind',
  'sincerely', 'regards', 'cordially', 'kindly',
  // ── Medical extras ───────────────────────────────────────────────
  'pharmacy', 'pharmacist', 'lab', 'laboratory', 'test', 'tests', 'result', 'results',
  'symptom', 'symptoms', 'condition', 'conditions',
  'reaction', 'reactions', 'adverse', 'allergy', 'allergies', 'allergic',
  'side', 'effects', 'effect', 'severe', 'mild', 'moderate',
  'tablets', 'capsules', 'syrups', 'injections', 'drops',
  'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'first', 'second', 'third', 'fourth', 'fifth',
  // ── Common verbs / connectors that show up in glued prose ───────
  'is', 'are', 'was', 'were', 'been', 'being',
  'have', 'has', 'had', 'having',
  'will', 'would', 'could', 'should',
  'do', 'does', 'did', 'doing', 'done',
  'go', 'going', 'gone', 'went',
  'see', 'saw', 'seen', 'seeing',
  'come', 'came', 'coming',
  'take', 'taken', 'taking', 'took',
  'give', 'given', 'giving', 'gave',
  'use', 'used', 'using',
  'find', 'found', 'finding',
  'know', 'knew', 'known', 'knowing',
  'think', 'thought', 'thinking',
  'tell', 'told', 'telling',
  'become', 'became', 'becoming',
  'leave', 'left', 'leaving',
  'feel', 'felt', 'feeling',
  'bring', 'brought', 'bringing',
  'all', 'any', 'some', 'every', 'each', 'either', 'neither', 'none', 'many', 'few',
  'more', 'most', 'less', 'least',
  'one', 'two', 'a', 'an', 'the',
  // ── Words missed during multi-page handbook generation ──────────
  // "code of conduct" was the regression that surfaced these — the
  // segmenter needs every component word in the dict to find a full
  // covering of the glued string.
  'code', 'codes', 'coded', 'coding',
  'understand', 'understands', 'understanding', 'understood',
  'appreciate', 'appreciated', 'appreciating', 'appreciation',
  'cooperate', 'cooperated', 'cooperating', 'cooperation', 'cooperative',
  'believe', 'believed', 'believing', 'belief', 'beliefs',
  'strongly', 'strong', 'stronger', 'strongest',
  'discuss', 'discussed', 'discussing', 'discussion', 'discussions',
  'important', 'importantly', 'importance',
  'necessary', 'unnecessary', 'necessarily', 'necessity',
  'possible', 'impossible', 'possibly', 'possibility',
  'additional', 'additionally', 'addition',
  'provide', 'provided', 'providing', 'provider', 'provision',
  'ensure', 'ensures', 'ensured', 'ensuring',
  'maintain', 'maintains', 'maintained', 'maintaining', 'maintenance',
  'develop', 'develops', 'developed', 'developing', 'development', 'developer',
  'train', 'training', 'trained', 'trainee', 'trainer', 'trainers',
  'career', 'careers',
  'opportunity', 'opportunities',
  'create', 'created', 'creating', 'creation', 'creative',
  'achieve', 'achieves', 'achieved', 'achieving', 'achievement', 'achievements',
  'deliver', 'delivers', 'delivered', 'delivering', 'delivery',
  'high', 'higher', 'highest', 'low', 'lower', 'lowest',
  'quality', 'qualities',
  'efficient', 'efficiently', 'efficiency', 'effective', 'effectively', 'effectiveness',
  'improve', 'improves', 'improved', 'improving', 'improvement', 'improvements',
  'suggest', 'suggests', 'suggested', 'suggesting', 'suggestion', 'suggestions',
  'implement', 'implements', 'implemented', 'implementing', 'implementation',
  'manage', 'manages', 'managed', 'managing', 'management',
  'operate', 'operates', 'operated', 'operating', 'operation', 'operations', 'operational',
  'client', 'clients',
  'stakeholder', 'stakeholders',
  'partner', 'partners', 'partnership', 'partnerships',
  'vendor', 'vendors', 'supplier', 'suppliers',
  'project', 'projects', 'task', 'tasks',
  'goal', 'goals', 'target', 'targets',
  'objective', 'objectives', 'strategy', 'strategies', 'strategic',
  'plan', 'plans', 'planned', 'planning',
  'execute', 'execution', 'monitor', 'monitoring', 'monitored',
  'track', 'tracks', 'tracked', 'tracking',
  'measure', 'measures', 'measured', 'measurement', 'measurements',
  'analyze', 'analyse', 'analyzed', 'analysed', 'analyzing', 'analysing', 'analysis',
  'research', 'researching', 'researched',
  'assist', 'assists', 'assisted', 'assisting', 'assistance', 'assistant',
  'advice', 'advise', 'advised', 'advising', 'advisor', 'adviser',
  'request', 'requests', 'requested', 'requesting',
  'approve', 'approves', 'approved', 'approving', 'approval', 'approvals',
  'decide', 'decided', 'deciding', 'decision', 'decisions',
  'choose', 'chooses', 'chose', 'chosen', 'choosing', 'choice', 'choices',
  'offer', 'offers', 'offered', 'offering',
  'accept', 'accepts', 'accepted', 'accepting', 'acceptance', 'acceptable', 'unacceptable',
  'reject', 'rejects', 'rejected', 'rejecting', 'rejection',
  'reply', 'replies', 'replied', 'replying',
  'respond', 'responds', 'responded', 'responding',
  'send', 'sends', 'sent', 'sending', 'sender',
  'receive', 'receives', 'received', 'receiving', 'receiver', 'recipient', 'recipients',
  'process', 'processes', 'processed', 'processing',
  'deal', 'deals', 'dealt', 'dealing',
  'face', 'faces', 'faced', 'facing',
  'follow', 'follows', 'followed', 'following', 'follower', 'followers',
  'engage', 'engages', 'engaged', 'engaging', 'engagement',
  'involve', 'involves', 'involved', 'involving', 'involvement',
  'join', 'joins', 'joined', 'joining',
  'leave', 'leaves', 'left', 'leaving', 'leaver',
  'hire', 'hires', 'hired', 'hiring',
  'recruit', 'recruits', 'recruited', 'recruiting', 'recruitment', 'recruiter',
  'fire', 'fired', 'firing',
  'promote', 'promoted', 'promoting', 'promotion', 'promotions',
  'demote', 'demoted', 'demotion',
  'transfer', 'transfers', 'transferred', 'transferring',
  'resign', 'resigned', 'resigning', 'resignation',
  'terminate', 'terminated', 'terminating', 'termination',
  'team', 'teams', 'collaborate', 'collaboration',
  'safety', 'safe', 'safely', 'unsafe',
  'emergency', 'emergencies', 'evacuation', 'fire', 'alarm', 'alarms',
  'first', 'aid', 'help', 'rescue',
  'workplace', 'workspace', 'office', 'offices', 'remote', 'hybrid', 'onsite',
  'home', 'house', 'building', 'floor', 'floors', 'room', 'rooms', 'desk', 'desks',
  'meeting', 'meetings', 'event', 'events', 'session', 'sessions',
  'training', 'workshop', 'workshops', 'seminar', 'seminars', 'conference', 'conferences',
  'learn', 'learns', 'learned', 'learnt', 'learning', 'learner', 'learners',
  'teach', 'teaches', 'taught', 'teaching', 'teacher', 'teachers',
  'mentor', 'mentors', 'mentored', 'mentoring', 'mentorship',
  'coach', 'coaches', 'coached', 'coaching',
  'culture', 'cultures', 'cultural',
  'diverse', 'diversity', 'inclusion', 'inclusive', 'belonging',
  'equality', 'equity', 'equitable', 'fairness', 'fair',
  'gender', 'race', 'ethnicity', 'religion', 'orientation', 'identity',
  'wellness', 'wellbeing', 'mental', 'physical', 'social',
  'family', 'families', 'children', 'child', 'parent', 'parents', 'spouse',
  'personal', 'personally', 'private', 'public', 'profession', 'professional',
  'standard', 'standards', 'standardize', 'standardized',
  'document', 'documents', 'documented', 'documenting', 'documentation',
  'record', 'records', 'recorded', 'recording',
  'file', 'files', 'filed', 'filing',
  'store', 'stores', 'stored', 'storing', 'storage',
  'archive', 'archives', 'archived', 'archiving',
  'backup', 'restore', 'recover', 'recovered', 'recovery',
  'budget', 'budgets', 'budgeted', 'budgeting',
  'expense', 'expenses', 'expensed', 'spending', 'spent',
  'reimburse', 'reimbursed', 'reimbursement', 'reimbursements',
  'invoice', 'invoices', 'invoiced', 'invoicing',
  'audit', 'audits', 'audited', 'auditing', 'auditor',
  'finance', 'financial', 'financially',
  'asset', 'assets', 'liability', 'liabilities',
  'profit', 'profits', 'loss', 'losses',
  'revenue', 'revenues', 'income', 'incomes',
  'tax', 'taxes', 'taxed', 'taxable', 'taxation',
  'fiscal', 'quarter', 'quarters', 'quarterly',
  // Politeness / correspondence vocabulary
  'please', 'kindly', 'thanks', 'thank',
  'apology', 'apologies', 'apologize', 'apologise', 'apologized', 'apologised',
  'sorry', 'regret', 'regrets', 'regretted',
  'concern', 'concerns', 'concerned', 'concerning',
  'issue', 'issues', 'issued', 'issuing',
  'matter', 'matters', 'mattered',
  'happy', 'glad', 'pleased', 'delighted', 'excited',
  'hope', 'hopes', 'hoped', 'hoping', 'hopeful',
  'best', 'wishes', 'wish', 'wished', 'wishing',
  'warm', 'warmly', 'warmth',
  // High-frequency English filler verbs / adverbs that show up in glued prose
  'enjoy', 'enjoys', 'enjoyed', 'enjoying', 'enjoyable', 'enjoyment',
  'feel', 'feels', 'felt', 'feeling', 'feelings',
  'free', 'freely', 'freedom',
  'reach', 'reaches', 'reached', 'reaching',
  'hesitate', 'hesitated', 'hesitating', 'hesitation',
  'deeply', 'deep', 'deeper', 'deepest',
  'truly', 'true', 'truth', 'truthful',
  'really', 'real', 'realize', 'realized', 'realizing',
  'simply', 'simple', 'simpler', 'simplest', 'simplicity',
  'easily', 'easy', 'easier', 'easiest',
  'quickly', 'quick', 'quicker', 'quickest', 'quickness',
  'slowly', 'slow', 'slower', 'slowest',
  'closely', 'close', 'closer', 'closest', 'closure',
  'directly', 'direct', 'director', 'direction', 'directions',
  'clearly', 'clear', 'clearer', 'clearest', 'clarity', 'clarify',
  'immediately', 'immediate',
  'soon', 'sooner', 'soonest',
  'later', 'latest', 'lately', 'late',
  'always', 'never', 'often', 'sometimes', 'rarely', 'usually',
  'today', 'tomorrow', 'yesterday', 'tonight',
  'forever', 'meanwhile', 'thereafter',
  'support', 'supports', 'supported', 'supporting', 'supporter', 'supporters', 'supportive',
  'cooperation', 'collaboration',
  'do', 'does', 'did', 'don', 'doesn', 'didn',
  'not', 'cannot', 'won', 'shouldn', 'wouldn', 'couldn',
  'just', 'only', 'almost', 'nearly', 'rather',
  // Sense verbs and value-related forms
  'hear', 'hears', 'heard', 'hearing',
  'speak', 'speaks', 'spoke', 'spoken', 'speaking', 'speaker',
  'talk', 'talks', 'talked', 'talking',
  'say', 'says', 'said', 'saying',
  'value', 'values', 'valued', 'valuing', 'valuable', 'invaluable',
  'price', 'prices', 'priced', 'pricing',
  'cost', 'costs', 'costing', 'costly',
  'worth', 'worthy', 'worthwhile',
  // Common single-syllable nouns and structural words that turned up missing
  // in real glued-prose tests (table of contents, conflicts of interest, etc.)
  'table', 'tables', 'tabled', 'tabling',
  'conflict', 'conflicts', 'conflicted', 'conflicting',
  'interest', 'interests', 'interested', 'interesting',
  'list', 'lists', 'listed', 'listing',
  'index', 'indexes', 'indexed', 'indexing',
  'chapter', 'chapters', 'section', 'sections', 'subsection',
  'page', 'pages', 'paged', 'paging',
  'figure', 'figures', 'image', 'images', 'photo', 'photos', 'picture', 'pictures',
  'item', 'items',
  'content', 'contents',
  'header', 'headers', 'heading', 'headings',
  'footer', 'footers',
  'title', 'titles', 'subtitle', 'subtitles',
  'caption', 'captions',
])

const MIN_WORD_LEN = 2
const MAX_WORD_LEN = 16

/**
 * Try to split a single lowercase token into its component words using the
 * built-in dictionary. Returns the segmented array on success, or
 * {@code [input]} if every character can't be covered by known words.
 *
 * Implementation: O(n²) DP over end-positions. For each position i, we
 * find the best score among all "k → i" cuts where {@code input.slice(k, i)}
 * is a known word, plus the best score reaching position k. Score per
 * word = length² so the segmenter prefers fewer, longer words ("thank"
 * + "you" beats "tha" + "nk" + "you").
 */
export function segmentLowercaseConcat(input: string): string[] {
  const s = input
  if (!s || s.length < 4) return [s]
  if (!/^[a-z]+$/.test(s)) return [s]
  const n = s.length
  // best[i] = { score, prev } — max-score segmentation that ends exactly at i
  const best: Array<{ score: number; prev: number } | null> = new Array(n + 1).fill(null)
  best[0] = { score: 0, prev: -1 }
  for (let i = 1; i <= n; i++) {
    for (
      let k = Math.max(0, i - MAX_WORD_LEN);
      k <= i - MIN_WORD_LEN || (k === i - 1 && (s[k] === 'a' || s[k] === 'i'));
      k++
    ) {
      const word = s.slice(k, i)
      if (!DICT.has(word)) continue
      const prev = best[k]
      if (!prev) continue
      const score = prev.score + word.length * word.length
      const cur = best[i]
      if (!cur || score > cur.score) best[i] = { score, prev: k }
    }
  }
  const tail = best[n]
  if (!tail) return [s]
  const out: string[] = []
  let i = n
  while (i > 0) {
    const cell = best[i]!
    out.push(s.slice(cell.prev, i))
    i = cell.prev
  }
  out.reverse()
  return out
}
