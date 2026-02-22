// Use relative path for API - works with same-origin requests
const API_URL = '/api';

let dynamicSequence = []; // 动态序列，存储题目ID
let questionMap = new Map(); // 映射：ID -> 题目对象
let currentItem = null;
let fileName = "";
let totalItems = 0; // 总题目数
let masteredItems = 0; // 已掌握的题目数
let isEditMode = false; // 是否处于编辑模式
let isTodayCompleted = false; // 今日复习是否已完成

// 异步保存管理
let needSaveLongTerm = false; // 需要保存长期参数
let needSaveDailyList = false; // 需要保存每日列表
let isSaving = false; // 是否正在保存中（防重入）

// 立即保存所有待处理的保存请求
async function flushPendingSaves() {
    console.log('🚀 Flushing pending saves...');
    await saveLongTermParams(true);
    await saveDailyListToServer(true);
    console.log('✅ All pending saves flushed');
}

// 保存进度到localStorage和服务器
function saveProgress() {
    if (!fileName) return;
    const progressKey = `progress_${fileName}`;
    const progressData = {
        questionMap: Array.from(questionMap.entries()),
        masteredItems: masteredItems,
        totalItems: totalItems,
        dynamicSequence: dynamicSequence
    };
    try {
        localStorage.setItem(progressKey, JSON.stringify(progressData));
        console.log(`💾 Progress saved to localStorage: ${fileName}`);
    } catch (e) {
        console.error('❌ Failed to save progress to localStorage:', e);
    }

    // 异步保存到服务器（不阻塞主线程）
    saveProgressToServer(progressData).catch(e => {
        console.error('❌ Failed to save progress to server:', e);
    });
}

// 保存进度到服务器
async function saveProgressToServer(progressData) {
    if (!fileName) return;

    try {
        const response = await fetch(`${API_URL}/save-state`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                file_name: fileName,
                userState: {
                    totalItems: totalItems,
                    masteredItems: masteredItems,
                    isTodayCompleted: isTodayCompleted,
                    lastReviewDay: '' // 从localStorage中获取，如果需要的话
                },
                questionMap: progressData.questionMap.reduce((map, [id, card]) => {
                    map[id] = card;
                    return map;
                }, {}),
                dynamicSequence: progressData.dynamicSequence
            })
        });

        if (response.ok) {
            console.log(`💾 Progress saved to server: ${fileName}`);
        } else {
            console.warn(`⚠️ Server save failed: ${response.status}`);
        }
    } catch (error) {
        // 网络错误，静默失败（localStorage已保存）
        console.debug('Server save failed (network error):', error.message);
    }
}

// 保存长期记忆参数到服务器
// force: 是否强制保存（忽略needSaveLongTerm标志）
async function saveLongTermParams(force = false) {
    if (!fileName) return;
    if (!force && !needSaveLongTerm) return;
    if (isSaving) {
        console.log('⏳ Save already in progress, skipping');
        return;
    }

    isSaving = true;
    needSaveLongTerm = false;

    // 构建长期参数数据
    const cards = {};
    questionMap.forEach((card, id) => {
        cards[id] = {
            longTermN: card._longTermN || 0,
            intervalDays: card._intervalDays || 1,
            ef: card._ef || 2.5,
            dueDate: card._dueDate || "",
            lastReviewed: card._lastReviewed || "",
            createdAt: card._createdAt || "",
            mastered: card._mastered || false
        };
    });

    const paramsData = {
        version: "1.0",
        last_updated: new Date().toISOString().split('T')[0], // YYYY-MM-DD
        cards: cards
    };

    try {
        try {
            const response = await fetch(`${API_URL}/save-long-term-params`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    file_name: fileName,
                    params_data: paramsData
                })
            });

            if (response.ok) {
                console.log('💾 Long-term parameters saved to server');
            } else {
                console.warn('⚠️ Failed to save long-term parameters to server');
            }
        } catch (error) {
            console.error('❌ Error saving long-term parameters:', error);
        }
    } finally {
        isSaving = false;
    }

    // Also save daily list (independent, don't block on errors)
    try {
        await saveDailyListToServer(true);
    } catch (error) {
        console.error('❌ Error saving daily list in auto-save:', error);
    }
}

// Load daily review list from server (.data directory)
async function loadDailyListFromServer() {
    if (!fileName) return null;

    try {
        const response = await fetch(`${API_URL}/load-daily-list`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ file_name: fileName })
        });

        if (response.ok) {
            const data = await response.json();
            return data;
        } else {
            console.warn('⚠️ Failed to load daily list from server');
            return null;
        }
    } catch (error) {
        console.error('❌ Error loading daily list:', error);
        return null;
    }
}

// Save daily review list to server (.data directory)
// force: 是否强制保存（忽略needSaveDailyList标志）
async function saveDailyListToServer(force = false) {
    if (!fileName) return false;
    if (!force && !needSaveDailyList) return false;
    if (!dynamicSequence) {
        console.warn('⚠️ Cannot save daily list: dynamicSequence is undefined');
        return false;
    }

    needSaveDailyList = false;

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const dailyListData = {
        last_generated_date: today,
        sequence: [...dynamicSequence] // Copy current sequence
    };

    console.log(`💾 Saving daily list to server: ${dailyListData.sequence.length} cards, sequence: ${JSON.stringify(dailyListData.sequence.slice(0, 5))}...`);

    try {
        const response = await fetch(`${API_URL}/save-daily-list`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                file_name: fileName,
                daily_list_data: dailyListData
            })
        });

        if (response.ok) {
            console.log(`✅ Daily list saved to server: ${dailyListData.sequence.length} cards`);
            return true;
        } else {
            console.warn(`⚠️ Failed to save daily list to server: HTTP ${response.status}`);
            // Try one more time
            try {
                const retryResponse = await fetch(`${API_URL}/save-daily-list`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        file_name: fileName,
                        daily_list_data: dailyListData
                    })
                });
                if (retryResponse.ok) {
                    console.log(`✅ Daily list saved on retry`);
                    return true;
                } else {
                    console.warn(`⚠️ Retry also failed: HTTP ${retryResponse.status}`);
                }
            } catch (retryError) {
                console.error('❌ Retry failed:', retryError);
            }
            return false;
        }
    } catch (error) {
        console.error('❌ Error saving daily list:', error);
        return false;
    }
}

// 从服务器或localStorage加载进度
async function loadProgress(fileName) {
    if (!fileName) return null;

    // 首先尝试从服务器加载
    try {
        const response = await fetch(`${API_URL}/load-state`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ file_name: fileName })
        });

        if (response.ok) {
            const serverData = await response.json();
            if (serverData.exists) {
                console.log(`📂 Loaded progress from server: ${fileName}`);

                // 转换服务器数据为localStorage格式
                const questionMapArray = Object.entries(serverData.questionMap || {});
                return {
                    questionMap: questionMapArray,
                    masteredItems: serverData.userState.masteredItems || 0,
                    totalItems: serverData.userState.totalItems || 0,
                    dynamicSequence: serverData.dynamicSequence || []
                };
            }
        }
    } catch (error) {
        console.debug('Failed to load from server, falling back to localStorage:', error.message);
    }

    // 服务器加载失败，回退到localStorage
    const progressKey = `progress_${fileName}`;
    try {
        const saved = localStorage.getItem(progressKey);
        if (saved) {
            const progressData = JSON.parse(saved);
            console.log(`📂 Loaded saved progress from localStorage: ${fileName}`);
            return progressData;
        }
    } catch (e) {
        console.error('❌ Failed to load progress from localStorage:', e);
    }
    return null;
}

// 生成随机间隔（8-12之间）
function getRandomInterval() {
    return Math.floor(Math.random() * 5) + 8; // 8到12之间的随机数
}

// 生成较长的随机间隔（15-20之间）
function getLongRandomInterval() {
    return Math.floor(Math.random() * 6) + 15; // 15到20之间的随机数
}

document.addEventListener('keydown', (e) => {
    const preAnswerVisible = document.getElementById('pre-answer-btns').style.display !== 'none';
    const postAnswerVisible = document.getElementById('post-answer-btns').style.display !== 'none';
    const key = e.key.toLowerCase();

    if ((key === ' ' || e.code === 'Space') && preAnswerVisible) {
        e.preventDefault();
        showAnswer();
    }
    else if (key === 'f' && postAnswerVisible) {
        e.preventDefault();
        handleAction('forgotten');
    }
    else if (key === 'j' && postAnswerVisible) {
        e.preventDefault();
        handleAction('recognized');
    }
});

// ======================================================================
// Daily review limit modal functions
// ======================================================================

// Show daily limit modal and return promise with user's limit
function showDailyLimitModal(dueCount, newCount) {
    return new Promise((resolve, reject) => {
        const modal = document.getElementById('daily-limit-modal');
        const dueSpan = document.getElementById('due-count');
        const newSpan = document.getElementById('new-count');
        const input = document.getElementById('daily-limit-input');
        const confirmBtn = document.getElementById('daily-limit-confirm');
        const cancelBtn = document.getElementById('daily-limit-cancel');

        // Update counts
        dueSpan.textContent = dueCount;
        newSpan.textContent = newCount;

        // Set default value (dueCount + Math.min(5, newCount))
        const defaultLimit = Math.max(5, dueCount + Math.min(5, newCount));
        input.value = defaultLimit;
        input.min = 5;

        // Show modal
        modal.style.display = 'flex';

        // Confirm handler
        function onConfirm() {
            const limit = parseInt(input.value);
            if (isNaN(limit) || limit < 5) {
                alert('Please enter a number greater than or equal to 5');
                return;
            }
            hideModal();
            resolve(limit);
        }

        // Cancel handler
        function onCancel() {
            hideModal();
            reject(new Error('User cancelled'));
        }

        function hideModal() {
            modal.style.display = 'none';
            // Clean up event listeners
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
            input.removeEventListener('keypress', onEnter);
        }

        function onEnter(e) {
            if (e.key === 'Enter') {
                onConfirm();
            }
        }

        // Add event listeners
        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
        input.addEventListener('keypress', onEnter);
        input.focus();
        input.select();
    });
}

// Select cards based on priority and user limit
function selectCardsByPriority(dueCards, newCards, yesterdayUnfinished, userLimit) {
    const selectedCards = [];

    // 1. Add yesterday's unfinished cards first (highest priority)
    yesterdayUnfinished.forEach(id => {
        if (questionMap.has(id) && selectedCards.length < userLimit) {
            selectedCards.push(id);
        }
    });

    // 2. Sort due cards by due date (earliest first)
    const sortedDueCards = [...dueCards].sort((a, b) => {
        const dateA = a.card._dueDate || '9999-12-31';
        const dateB = b.card._dueDate || '9999-12-31';
        return dateA.localeCompare(dateB);
    });

    // Add due cards (excluding those already added from yesterday)
    for (const item of sortedDueCards) {
        if (selectedCards.length >= userLimit) break;
        if (!yesterdayUnfinished.has(item.id)) {
            selectedCards.push(item.id);
        }
    }

    // 3. Add new cards (at least 5 if possible, excluding already added)
    const minNewCards = 5;
    let newCardsAdded = 0;

    // Calculate how many slots left for new cards
    const slotsLeft = userLimit - selectedCards.length;
    if (slotsLeft > 0) {
        // Try to add at least 5 new cards, but not more than slotsLeft or available new cards
        const newCardsToAdd = Math.min(newCards.length, Math.max(minNewCards, slotsLeft));
        // But ensure we don't exceed slotsLeft
        const actualNewCardsToAdd = Math.min(newCardsToAdd, slotsLeft);

        for (const item of newCards) {
            if (newCardsAdded >= actualNewCardsToAdd) break;
            if (!yesterdayUnfinished.has(item.id) && !selectedCards.includes(item.id)) {
                selectedCards.push(item.id);
                newCardsAdded++;
            }
        }
    }

    console.log(`🎯 Selected ${selectedCards.length} cards: ${yesterdayUnfinished.size} yesterday unfinished, ${selectedCards.length - yesterdayUnfinished.size - newCardsAdded} due, ${newCardsAdded} new`);
    return selectedCards;
}

async function loadLibrary() {
    // 保存当前文件的进度（如果已加载）
    if (fileName) {
        saveProgress();
    }
    if (!fileName) {
        console.error('No file name specified');
        return;
    }
    console.log(`📖 Loading library: ${fileName}`);

    try {
        const res = await fetch(`${API_URL}/load`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ file_name: fileName })
        });
    
        if (!res.ok) {
            let errorDetail = `HTTP Error ${res.status}`;
            try {
                const data = await res.json();
                if (data.error) {
                    errorDetail = data.error;
                }
            } catch (e) {}
            throw new Error(errorDetail);
        }
      
        const data = await res.json();

        // 加载长期记忆参数（从服务器）
        let longTermParams = {};
        try {
            const longTermRes = await fetch(`${API_URL}/load-long-term-params`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ file_name: fileName })
            });
            if (longTermRes.ok) {
                const longTermData = await longTermRes.json();
                longTermParams = longTermData.cards || {};
            } else {
                console.warn('⚠️ Failed to load long-term parameters, using defaults');
            }
        } catch (error) {
            console.warn('⚠️ Error loading long-term parameters:', error);
        }

        // 加载已保存的进度（如果存在）
        const savedProgress = await loadProgress(fileName);
        const savedMap = savedProgress ? new Map(savedProgress.questionMap) : new Map();

        // 初始化题目映射和动态序列
        questionMap = new Map();
        dynamicSequence = [];

        data.items.forEach(item => {
            // 检查是否有已保存的状态
            const savedState = savedMap.get(item.id);
            // 获取长期参数
            const longTermCard = longTermParams[item.id] || {};
            // 创建题目对象，合并已保存的状态和长期参数
            const questionObj = {
                ...item,
                _reviewCount: savedState?._reviewCount || 0, // 本地复习次数
                _consecutiveCorrect: savedState?._consecutiveCorrect || 0, // 本地连续正确次数
                _learningStep: savedState?._learningStep || 0, // 学习步骤：0=初始，1=第一次不记得后，2=第一次记得后，3=掌握
                _mastered: savedState?._mastered || false, // 本地掌握状态（当天）
                _wrongCount: savedState?._wrongCount || 0, // 错误次数
                _correctCount: savedState?._correctCount || 0, // 正确次数
                _wrongToday: savedState?._wrongToday || false, // 当天是否答错过
                // 长期记忆参数
                _longTermN: longTermCard.longTermN || 0,
                _intervalDays: longTermCard.intervalDays || 1,
                _ef: longTermCard.ef || 2.5,
                _dueDate: longTermCard.dueDate || "",
                _lastReviewed: longTermCard.lastReviewed || "",
                _createdAt: longTermCard.createdAt || ""
            };

            questionMap.set(item.id, questionObj);
            dynamicSequence.push(item.id); // 所有题目都加入序列
        });

        totalItems = data.items.length;
        // 计算已掌握的题目数
        masteredItems = Array.from(questionMap.values()).filter(q => q._mastered).length;

        // Check for existing daily list on server (priority)
        const today = new Date().toISOString().split('T')[0];
        const dailyList = await loadDailyListFromServer();

        // Case 1: Today's list exists and has cards
        if (dailyList && dailyList.last_generated_date === today && dailyList.sequence && dailyList.sequence.length > 0) {
            isTodayCompleted = false; // Not completed, has cards to review
            // Use today's daily list from server
            dynamicSequence = dailyList.sequence.filter(id => questionMap.has(id));
            console.log(`📊 Using today's daily list from server (${dynamicSequence.length} cards)`);

            // Update last review day in localStorage to today
            updateLastReviewDay(fileName);

            // Save progress with the server sequence
            saveProgress();
        }
        // Case 2: Today's list exists but is empty (review completed for today)
        else if (dailyList && dailyList.last_generated_date === today && dailyList.sequence && dailyList.sequence.length === 0) {
            console.log('✅ Today\'s review already completed (empty sequence)');
            dynamicSequence = []; // Empty sequence
            isTodayCompleted = true; // Mark today as completed
            // Update last review day in localStorage to today
            updateLastReviewDay(fileName);
            // Show "all done" immediately
        }
        // Case 3: No valid today's list on server (yesterday's list, older, or no list)
        else {
            isTodayCompleted = false; // Not completed, need to create/review
            let yesterdayList = null;
            if (dailyList && dailyList.last_generated_date) {
                // Check if the server list is from yesterday
                const yesterday = new Date();
                yesterday.setDate(yesterday.getDate() - 1);
                const yesterdayStr = yesterday.toISOString().split('T')[0];
                if (dailyList.last_generated_date === yesterdayStr) {
                    yesterdayList = dailyList;
                    console.log(`📅 Found yesterday's list on server (${yesterdayList.sequence?.length || 0} cards)`);
                }
            }

            // Check if it's a new day based on server list date or localStorage
            const isNewDayFlag = !dailyList || dailyList.last_generated_date !== today;

            if (isNewDayFlag) {
                console.log('🆕 New day detected, creating daily review list');
                // Create daily review list with reference to yesterday's list
                await createDailyReviewList(yesterdayList);
                // Update last review date
                updateLastReviewDay(fileName);
                // Save progress (including new dynamic sequence)
                saveProgress();
            } else if (savedProgress && savedProgress.dynamicSequence) {
                // Not a new day, use saved review sequence from localStorage
                const savedSeq = savedProgress.dynamicSequence.filter(id => questionMap.has(id));
                // If saved sequence is not empty, use it (may contain mastered items, that's ok)
                if (savedSeq.length > 0) {
                    dynamicSequence = savedSeq;
                    console.log(`🔄 Using saved review sequence from localStorage, length: ${dynamicSequence.length}`);
                    // Save to server to ensure synchronization
                    setTimeout(() => {
                        saveDailyListToServer(true).catch(e => console.error('Failed to save localStorage sequence to server:', e));
                    }, 200);
                }
            } else {
                // No saved progress, shuffle initial sequence
                shuffleArray(dynamicSequence);
                // Save the shuffled sequence to server and localStorage
                saveProgress();
                setTimeout(() => {
                    saveDailyListToServer(true).catch(e => console.error('Failed to save shuffled sequence to server:', e));
                }, 200);
            }
        }

        currentItem = null;
        showQuestion();
    
    } catch (error) {
        console.error('❌ Load failed:', error);
        document.getElementById('content-q').innerText = `Load failed: ${error.message}`;
        document.getElementById('progress-tag').innerText = `0/0`;
    }
}

// 检查是否是新的一天
function isNewDay(fileName) {
    const lastReviewKey = `last_review_day_${fileName}`;
    try {
        const lastDay = localStorage.getItem(lastReviewKey);
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        return lastDay !== today;
    } catch (e) {
        console.error('Error checking new day:', e);
        return true; // 如果出错，假设是新的一天
    }
}

// 更新最后复习日期
function updateLastReviewDay(fileName) {
    const lastReviewKey = `last_review_day_${fileName}`;
    try {
        const today = new Date().toISOString().split('T')[0];
        localStorage.setItem(lastReviewKey, today);
    } catch (e) {
        console.error('Error updating last review day:', e);
    }
}

// 获取今天需要复习的卡片
function getDueCards() {
    const today = new Date().toISOString().split('T')[0];
    const dueCards = [];
    questionMap.forEach((card, id) => {
        // 未掌握且到期日期小于等于今天
        if (!card._mastered && card._dueDate && card._dueDate <= today) {
            dueCards.push({ id, card });
        }
    });
    return dueCards;
}

// 获取新卡片（从未复习过的）
function getNewCards() {
    const newCards = [];
    questionMap.forEach((card, id) => {
        // 从未复习过（_reviewCount === 0）
        if (card._reviewCount === 0) {
            newCards.push({ id, card });
        }
    });
    return newCards;
}

// 重置所有卡片的当天状态
function resetDailyStates() {
    questionMap.forEach(card => {
        card._wrongToday = false;
        // 可以在这里重置其他当天状态
    });
    console.log('🔄 Reset daily states for all cards');
}

// 创建每日复习列表
// yesterdayList: optional daily list from yesterday to prioritize unfinished cards
async function createDailyReviewList(yesterdayList = null) {
    console.log('📅 Creating new daily review list...');

    // Reset daily states for all cards
    resetDailyStates();

    // Get due cards and new cards
    const dueCards = getDueCards();
    const newCards = getNewCards();

    console.log(`📊 Due cards: ${dueCards.length}, New cards: ${newCards.length}`);

    // Get yesterday's unfinished cards (if available)
    const yesterdayUnfinished = new Set();
    if (yesterdayList && yesterdayList.sequence) {
        yesterdayList.sequence.forEach(id => {
            const card = questionMap.get(id);
            if (card && !card._mastered) {
                yesterdayUnfinished.add(id);
            }
        });
        console.log(`📅 Yesterday's unfinished cards: ${yesterdayUnfinished.size}`);
    }

    // Calculate total available cards (yesterday unfinished + due + new)
    const totalAvailable = yesterdayUnfinished.size + dueCards.length + newCards.length;

    // If no cards available, create empty sequence and return
    if (totalAvailable === 0) {
        dynamicSequence = [];
        console.log('📭 No cards available for review today');
        await saveDailyListToServer(true);
        return;
    }

    // Show modal to get user limit
    let userLimit;
    try {
        userLimit = await showDailyLimitModal(dueCards.length, newCards.length);
    } catch (error) {
        // User cancelled, use default limit
        const defaultLimit = Math.max(5, dueCards.length + Math.min(5, newCards.length));
        userLimit = Math.min(defaultLimit, totalAvailable);
        console.log(`🚫 User cancelled, using default limit: ${userLimit}`);
    }

    // Ensure limit is not greater than total available
    userLimit = Math.min(userLimit, totalAvailable);

    // Select cards based on priority and user limit
    const selectedCards = selectCardsByPriority(dueCards, newCards, yesterdayUnfinished, userLimit);

    // Shuffle order (but keep some structure? Maybe shuffle fully)
    shuffleArray(selectedCards);

    // Update dynamic sequence
    dynamicSequence = selectedCards;

    console.log(`🔄 Created new daily review list with ${dynamicSequence.length} cards (user limit: ${userLimit}, yesterday: ${yesterdayUnfinished.size}, due: ${dueCards.length}, new: ${selectedCards.length - yesterdayUnfinished.size - (dueCards.length - Math.max(0, dueCards.length - (userLimit - yesterdayUnfinished.size)))})`);

    // Save the daily list to server
    await saveDailyListToServer(true);
}

// Fisher-Yates洗牌算法
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// 更新笔图标状态
function updatePencilButton() {
    const pencilBtn = document.getElementById('edit-pencil-btn');
    const postAnswerVisible = document.getElementById('post-answer-btns').style.display !== 'none';

    if (postAnswerVisible && currentItem && !isEditMode) {
        pencilBtn.style.display = 'flex';
        pencilBtn.style.opacity = '1';
        pencilBtn.disabled = false;
        pencilBtn.style.cursor = 'pointer';
    } else {
        pencilBtn.style.display = 'flex';
        pencilBtn.style.opacity = '0.3';
        pencilBtn.disabled = true;
        pencilBtn.style.cursor = 'not-allowed';
    }
}

// 进入编辑模式
function enterEditMode() {
    if (!currentItem || isEditMode) return;

    isEditMode = true;

    // 隐藏笔图标，显示编辑工具栏
    document.getElementById('edit-pencil-btn').style.display = 'none';
    document.getElementById('edit-toolbar').style.display = 'flex';

    // 保存原始内容
    const originalQuestion = currentItem.question;
    const originalAnswer = currentItem.answer;

    // 创建编辑界面
    const card = document.getElementById('card');
    const questionElem = document.getElementById('content-q');
    const answerElem = document.getElementById('content-a');

    // 保存原始显示状态
    const wasAnswerVisible = answerElem.style.display !== 'none';

    // 创建编辑表单
    const editForm = document.createElement('div');
    editForm.id = 'edit-form';
    editForm.innerHTML = `
        <div class="edit-field">
            <label class="edit-label">Question:</label>
            <textarea id="edit-question" class="edit-textarea" placeholder="Enter question...">${escapeHtml(originalQuestion)}</textarea>
        </div>
        <div class="edit-field">
            <label class="edit-label">Answer:</label>
            <textarea id="edit-answer" class="edit-textarea" placeholder="Enter answer...">${escapeHtml(originalAnswer)}</textarea>
        </div>
    `;

    // 替换卡片内容
    questionElem.style.display = 'none';
    answerElem.style.display = 'none';
    card.insertBefore(editForm, questionElem);

    // 隐藏复习按钮
    document.getElementById('pre-answer-btns').style.display = 'none';
    document.getElementById('post-answer-btns').style.display = 'none';

    // 焦点到问题输入框
    document.getElementById('edit-question').focus();
}

// 退出编辑模式
function exitEditMode() {
    if (!isEditMode) return;

    isEditMode = false;

    // 显示笔图标，隐藏编辑工具栏
    document.getElementById('edit-pencil-btn').style.display = 'flex';
    document.getElementById('edit-toolbar').style.display = 'none';

    // 移除编辑表单
    const editForm = document.getElementById('edit-form');
    if (editForm) {
        editForm.remove();
    }

    // 恢复问题答案显示
    document.getElementById('content-q').style.display = 'block';
    document.getElementById('content-a').style.display = 'block';

    // 更新笔图标状态
    updatePencilButton();
}

// 保存编辑
async function saveEdit() {
    if (!currentItem || !isEditMode) return;

    const newQuestion = document.getElementById('edit-question').value.trim();
    const newAnswer = document.getElementById('edit-answer').value.trim();

    if (!newQuestion || !newAnswer) {
        alert('Question and answer cannot be empty!');
        return;
    }

    // 如果内容没有变化，直接退出编辑模式
    if (newQuestion === currentItem.question && newAnswer === currentItem.answer) {
        exitEditMode();
        return;
    }

    try {
        // 调用API保存到文件
        const response = await fetch(`${API_URL}/update-item`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                file_name: fileName,
                item_id: currentItem.id,
                new_question: newQuestion,
                new_answer: newAnswer
            })
        });

        if (!response.ok) {
            throw new Error(`Failed to save changes: ${response.status}`);
        }

        const result = await response.json();

        if (result.success) {
            // 更新本地数据
            const oldId = currentItem.id;
            const newId = result.new_id || currentItem.id;

            // 更新题目对象
            currentItem.question = newQuestion;
            currentItem.answer = newAnswer;
            currentItem.id = newId; // ID可能会改变

            // 如果ID改变，更新questionMap
            if (oldId !== newId) {
                questionMap.delete(oldId);
                questionMap.set(newId, currentItem);

                // 更新dynamicSequence中的ID
                const index = dynamicSequence.indexOf(oldId);
                if (index !== -1) {
                    dynamicSequence[index] = newId;
                }
            }

            // 保存进度
            saveProgress();

            // 更新显示
            document.getElementById('content-q').innerText = newQuestion;
            document.getElementById('content-a').innerText = newAnswer;

            // 退出编辑模式
            exitEditMode();

            // 显示答案区域和按钮（保持在查看答案界面）
            document.getElementById('content-a').style.display = 'block';
            document.getElementById('post-answer-btns').style.display = 'block';
            document.getElementById('pre-answer-btns').style.display = 'none';

            // 更新笔图标状态
            updatePencilButton();

            console.log('✅ Item updated successfully');
        } else {
            throw new Error(result.error || 'Unknown error');
        }
    } catch (error) {
        console.error('❌ Failed to save edit:', error);
        alert(`Failed to save changes: ${error.message}`);
    }
}

// 简单的HTML转义
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showQuestion() {
    // 更新进度：已掌握的题目数/总题目数
    document.getElementById('progress-tag').innerText = `${masteredItems}/${totalItems}`;

    if (dynamicSequence.length === 0) {
        // 显示all done容器，隐藏卡片和按钮
        document.getElementById('card').style.display = 'none';
        document.getElementById('all-done-container').style.display = 'flex';
        document.getElementById('pre-answer-btns').style.display = 'none';
        document.getElementById('post-answer-btns').style.display = 'none';
        currentItem = null;

        // Set appropriate message based on completion type
        const messageElement = document.querySelector('#all-done-container .text-display');
        if (messageElement) {
            if (isTodayCompleted) {
                messageElement.textContent = '✅ Today\'s review completed!';
            } else {
                messageElement.textContent = '🎉 All questions have been mastered!';
            }
        }

        return;
    } else {
        // 显示卡片，隐藏all done容器
        document.getElementById('card').style.display = 'flex';
        document.getElementById('all-done-container').style.display = 'none';
    }

    // 从动态序列头部取出当前题目
    const currentId = dynamicSequence[0];
    currentItem = questionMap.get(currentId);

    if (!currentItem) {
        // 如果映射中没有找到题目，从序列中移除并尝试下一个
        dynamicSequence.shift();
        console.log(`⚠️ Card not found in map, removed from sequence, length: ${dynamicSequence.length}`);

        // 如果序列变空，标记今日已完成
        if (dynamicSequence.length === 0) {
            isTodayCompleted = true;
            console.log('✅ Today\'s review completed (invalid card removed, sequence empty)');
        }

        // Save the updated sequence
        setTimeout(() => {
            saveDailyListToServer(true).catch(e => console.error('Failed to save after removing invalid card:', e));
        }, 100);
        showQuestion();
        return;
    }

    document.getElementById('content-q').innerText = currentItem.question;
    document.getElementById('content-a').style.display = 'none';
    document.getElementById('pre-answer-btns').style.display = 'block';
    document.getElementById('post-answer-btns').style.display = 'none';

    // 确保退出编辑模式（如果正在编辑）
    if (isEditMode) {
        exitEditMode();
    }

    // 更新笔图标状态
    updatePencilButton();
}

function showAnswer() {
    if (!currentItem) return;
    document.getElementById('content-a').innerText = currentItem.answer;
    document.getElementById('content-a').style.display = 'block';
    document.getElementById('pre-answer-btns').style.display = 'none';
    document.getElementById('post-answer-btns').style.display = 'block';

    // 更新笔图标状态（显示答案时可用）
    updatePencilButton();
}

// 更新长期记忆参数
function updateLongTermParams(card, action) {
    // 获取当前日期
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // 确保EF因子在有效范围内[1.3, 3.0]
    if (card._ef !== undefined) {
        card._ef = Math.max(Math.min(parseFloat(card._ef), 3.0), 1.3);
    }

    // 初始化创建日期（如果未设置）
    if (!card._createdAt) {
        card._createdAt = today;
    }

    // 更新最后复习日期
    card._lastReviewed = today;

    // 根据动作更新参数
    if (action === 'recognized') {
        // 用户答对
        // 检查当天是否没有答错过
        if (!card._wrongToday) {
            // 当天没有答错过，增加_longTermN
            card._longTermN = (card._longTermN || 0) + 1;
        }
        // 答对时EF保持不变
    } else if (action === 'forgotten') {
        // 用户答错
        card._longTermN = 0; // 重置连续正确次数
        card._wrongToday = true; // 标记当天答错过
        // 轻微惩罚EF因子，并限制在[1.3, 3.0]范围内
        let newEF = parseFloat(((card._ef || 2.5) - 0.2).toFixed(1));
        card._ef = Math.max(Math.min(newEF, 3.0), 1.3);
    }

    // 更新间隔天数
    updateIntervalDays(card);

    // 计算下次复习日期
    if (card._intervalDays > 0) {
        const nextDate = new Date();
        nextDate.setDate(nextDate.getDate() + card._intervalDays);
        card._dueDate = nextDate.toISOString().split('T')[0];
    } else {
        card._dueDate = ""; // 已掌握，没有到期日
    }
}

// 更新间隔天数（基于_longTermN和EF因子）
function updateIntervalDays(card) {
    const baseIntervals = [1, 1, 3, 7, 15, 30];
    const n = card._longTermN || 0;

    if (n >= 1 && n <= 6) {
        const baseDays = baseIntervals[n - 1];
        card._intervalDays = Math.round(baseDays * ((card._ef || 2.5) / 2.5));
    } else if (n >= 7) {
        card._mastered = true;
        card._intervalDays = 0;
    } else {
        card._intervalDays = 1;
    }
}

function handleAction(action) {
    if (!currentItem) return;

    const itemId = currentItem.id;
    const originalSequenceLength = dynamicSequence.length;
    const originalFirstItem = dynamicSequence[0];

    // 从动态序列中移除当前题目
    dynamicSequence.shift();
    console.log(`📝 Action: ${action}, removed ${itemId} from sequence, length: ${originalSequenceLength} -> ${dynamicSequence.length}`);

    // 更新本地状态
    currentItem._reviewCount++;

    if (action === 'recognized') {
        // 用户表示掌握
        currentItem._consecutiveCorrect++;
        currentItem._correctCount++;

        // 情况1：第一次复习就答对（首次记得）
        if (currentItem._reviewCount === 1) {
            currentItem._mastered = true;
            currentItem._learningStep = 3; // 掌握
            masteredItems++;
            console.log(`✅ First attempt correct, card mastered: ${currentItem.question.substring(0, 50)}...`);
        }
        // 情况2：处于学习步骤1（第一次不记得后）
        else if (currentItem._learningStep === 1) {
            // 第一次不记得后的记得：间隔15-20
            currentItem._learningStep = 2; // 进入步骤2
            const insertIndex = getLongRandomInterval(); // 15-20
            const actualIndex = Math.min(insertIndex, dynamicSequence.length);
            dynamicSequence.splice(actualIndex, 0, itemId);
            console.log(`📝 Inserted ${itemId} at position ${actualIndex}, sequence length: ${dynamicSequence.length}`);
            console.log(`🔄 First recognition after forgetting, review after ${actualIndex} positions (15-20): ${currentItem.question.substring(0, 50)}...`);
        }
        // 情况3：处于学习步骤2（第一次记得后）
        else if (currentItem._learningStep === 2) {
            // 第二次记得：掌握
            currentItem._mastered = true;
            currentItem._learningStep = 3; // 掌握
            masteredItems++;
            console.log(`✅ Second recognition, card mastered: ${currentItem.question.substring(0, 50)}...`);
        }
        // 其他情况（理论上不会发生）
        else {
            console.warn(`⚠️ Unknown state: reviewCount=${currentItem._reviewCount}, learningStep=${currentItem._learningStep}`);
        }

    } else if (action === 'forgotten') {
        // 用户表示未掌握
        currentItem._wrongCount++;
        currentItem._consecutiveCorrect = 0;
        currentItem._mastered = false;

        // 无论当前处于什么步骤，不记得都重置到步骤1
        currentItem._learningStep = 1; // 进入步骤1（第一次不记得后）

        // 计算插入位置：当前位置后8-12个位置
        const insertIndex = getRandomInterval();
        const actualIndex = Math.min(insertIndex, dynamicSequence.length);
        dynamicSequence.splice(actualIndex, 0, itemId);
        console.log(`📝 Inserted ${itemId} at position ${actualIndex}, sequence length: ${dynamicSequence.length}`);

        console.log(`❌ Answer incorrect, reset to step 1, review after ${actualIndex} positions (8-12): ${currentItem.question.substring(0, 50)}...`);
    }

    // 更新长期记忆参数
    updateLongTermParams(currentItem, action);

    // 保存进度到localStorage
    saveProgress();

    // 标记需要保存长期参数和每日列表
    needSaveLongTerm = true;
    needSaveDailyList = true;

    // 如果序列为空，标记今日已完成，并立即保存所有待处理数据
    if (dynamicSequence.length === 0) {
        isTodayCompleted = true;
        console.log('✅ Today\'s review completed (sequence empty)');
        // 立即保存所有待处理数据
        flushPendingSaves().catch(e => console.error('Failed to flush saves:', e));
    }

    // 显示下一题
    showQuestion();
}

// 跳转到报告页面
function viewReport() {
    if (!fileName) return;
    window.location.href = `/report?file=${encodeURIComponent(fileName)}`;
}

// Initialization
(async () => {
    try {
        // 设置编辑按钮事件监听器
        document.getElementById('edit-pencil-btn').addEventListener('click', () => {
            if (!document.getElementById('edit-pencil-btn').disabled) {
                enterEditMode();
            }
        });
        document.getElementById('cancel-edit-btn').addEventListener('click', exitEditMode);
        document.getElementById('save-edit-btn').addEventListener('click', saveEdit);

        // 添加返回按钮事件
        document.getElementById('back-btn').addEventListener('click', () => {
            window.location.href = '/';
        });

        // 获取URL参数中的文件名
        function getUrlParam(name) {
            const urlParams = new URLSearchParams(window.location.search);
            return urlParams.get(name);
        }
        const urlFile = getUrlParam('file');

        if (!urlFile) {
            document.getElementById('content-q').innerText = 'No knowledge base selected. Please select one from the home page.';
            document.getElementById('progress-tag').innerText = `0/0`;
            return;
        }

        // 验证文件存在
        const res = await fetch(`${API_URL}/files`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        const fileExists = data.files.find(f => f.name === urlFile);

        if (!fileExists) {
            document.getElementById('content-q').innerText = `Knowledge base "${urlFile}" not found.`;
            document.getElementById('progress-tag').innerText = `0/0`;
            return;
        }

        // 加载知识库
        fileName = urlFile;
        await loadLibrary();

        // 添加页面关闭前保存长期参数和每日列表
        window.addEventListener('beforeunload', () => {
            console.log('🔴 Page unloading, saving data...');
            saveLongTermParams(true);
            // Use synchronous fetch or try to save daily list
            try {
                // Create a synchronous-like save using fetch with keepalive
                const today = new Date().toISOString().split('T')[0];
                const dailyListData = {
                    last_generated_date: today,
                    sequence: [...(dynamicSequence || [])]
                };
                const blob = new Blob([JSON.stringify({
                    file_name: fileName,
                    daily_list_data: dailyListData
                })], {type: 'application/json'});

                // navigator.sendBeacon is more reliable for page unload
                navigator.sendBeacon(`${API_URL}/save-daily-list`, blob);
                console.log(`📤 Sent daily list via beacon: ${dailyListData.sequence.length} cards`);
            } catch (e) {
                console.error('Failed to save daily list on unload:', e);
            }
        });

        // 定期保存长期参数（每30秒）和每日列表（每15秒）
        setInterval(() => saveLongTermParams(true), 30000);
        setInterval(() => {
            if (fileName && dynamicSequence) {
                saveDailyListToServer(true).catch(e => console.error('Auto-save daily list failed:', e));
            }
        }, 15000);
    } catch (error) {
        console.error('❌ Initialization failed:', error);
        document.getElementById('progress-tag').innerText = `0/0`;
        document.getElementById('content-q').innerText = `Initialization failed. Please ensure the backend server is running: ${error.message}`;
    }
})();

// ======================================================================
// Report Page Functions
// These functions are used in report.html only
// ======================================================================

// Get filename from URL parameters (report page version)
function getReportUrlParam(name) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(name);
}

// Format text for CSV (escape quotes)
function csvEscape(str) {
    if (str === null || str === undefined) return '';
    str = String(str);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

// Load progress data from localStorage for report
function loadReportData() {
    const fileName = getReportUrlParam('file');
    if (!fileName) {
        document.getElementById('file-name').textContent = 'No file specified';
        showNoData();
        return null;
    }

    document.getElementById('file-name').textContent = fileName;
    const progressKey = `progress_${fileName}`;
    try {
        const saved = localStorage.getItem(progressKey);
        if (!saved) {
            showNoData();
            return null;
        }
        const progressData = JSON.parse(saved);
        return { fileName, progressData };
    } catch (e) {
        console.error('Error loading report data:', e);
        showNoData();
        return null;
    }
}

function showNoData() {
    document.getElementById('no-data').style.display = 'block';
    document.getElementById('report-table').style.display = 'none';
}

// Process and display data in report
function displayReport(data) {
    const { fileName, progressData } = data;
    const questionMap = new Map(progressData.questionMap);
    const items = Array.from(questionMap.values());

    // Sort by wrong count descending, then by correct count ascending
    items.sort((a, b) => {
        if (b._wrongCount !== a._wrongCount) {
            return b._wrongCount - a._wrongCount;
        }
        return a._correctCount - b._correctCount;
    });

    // Update file info
    const totalItems = items.length;
    const masteredItems = items.filter(q => q._mastered).length;
    const totalReviews = items.reduce((sum, q) => sum + q._reviewCount, 0);

    document.getElementById('total-count').textContent = totalItems;
    document.getElementById('mastered-count').textContent = masteredItems;
    document.getElementById('review-sessions').textContent = totalReviews;

    // Populate table
    const tbody = document.getElementById('table-body');
    tbody.innerHTML = '';

    items.forEach(item => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="id-col">${item.id}</td>
            <td class="question-col">${escapeHtml(item.question)}</td>
            <td class="count-col error-count">${item._wrongCount}</td>
            <td class="count-col correct-count">${item._correctCount}</td>
            <td class="count-col">${item._reviewCount}</td>
            <td class="count-col">${item._mastered ? '✅' : '❌'}</td>
        `;
        tbody.appendChild(row);
    });
}

// Simple HTML escaping
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Export menu functions
function showExportMenu() {
    const modal = document.getElementById('exportModal');
    modal.classList.add('active');
    // Add click outside to close
    modal.addEventListener('click', handleModalClick);
}

function hideExportMenu(event) {
    if (event) {
        event.stopPropagation();
    }
    const modal = document.getElementById('exportModal');
    modal.classList.remove('active');
    modal.removeEventListener('click', handleModalClick);
}

function handleModalClick(event) {
    const modal = document.getElementById('exportModal');
    // If click is on the overlay (not the modal content), close the modal
    if (event.target === modal) {
        hideExportMenu();
    }
}

// Close modal with Escape key
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        const modal = document.getElementById('exportModal');
        if (modal.classList.contains('active')) {
            hideExportMenu();
        }
    }
});

// Export functions
function exportHtml(event) {
    if (event) {
        event.stopPropagation();
    }
    const data = loadReportData();
    if (!data) return;

    const { progressData, fileName } = data;
    const questionMap = new Map(progressData.questionMap);
    const items = Array.from(questionMap.values());

    // Sort by wrong count descending
    items.sort((a, b) => b._wrongCount - a._wrongCount);

    // Calculate statistics
    const totalItems = items.length;
    const masteredItems = items.filter(q => q._mastered).length;
    const totalReviews = items.reduce((sum, q) => sum + q._reviewCount, 0);

    // Generate HTML content
    let htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Review Report - ${fileName}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background: #f5f5f5;
        }
        .report-header {
            background: linear-gradient(135deg, #bb86fc, #7e57c2);
            color: white;
            padding: 30px;
            border-radius: 12px;
            margin-bottom: 30px;
            text-align: center;
        }
        .report-header h1 {
            margin: 0 0 10px 0;
            font-size: 2.2em;
        }
        .report-header .subtitle {
            font-size: 1.1em;
            opacity: 0.9;
        }
        .stats-container {
            display: flex;
            justify-content: center;
            gap: 30px;
            flex-wrap: wrap;
            margin-bottom: 30px;
        }
        .stat-card {
            background: white;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            text-align: center;
            min-width: 150px;
        }
        .stat-value {
            font-size: 2em;
            font-weight: bold;
            color: #7e57c2;
            margin-bottom: 5px;
        }
        .stat-label {
            color: #666;
            font-size: 0.9em;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            background: white;
            border-radius: 10px;
            overflow: hidden;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }
        th, td {
            padding: 15px;
            text-align: left;
            border-bottom: 1px solid #e0e0e0;
        }
        th {
            background: linear-gradient(135deg, #bb86fc, #7e57c2);
            color: white;
            font-weight: 600;
        }
        tr:hover {
            background-color: rgba(187, 134, 252, 0.05);
        }
        .error-count {
            color: #d95e39;
            font-weight: bold;
        }
        .correct-count {
            color: #20897c;
            font-weight: bold;
        }
        .mastered-yes {
            color: #20897c;
            font-weight: bold;
        }
        .mastered-no {
            color: #d95e39;
            font-weight: bold;
        }
        .footer {
            text-align: center;
            margin-top: 40px;
            color: #888;
            font-size: 0.9em;
            padding-top: 20px;
            border-top: 1px solid #e0e0e0;
        }
        @media print {
            body {
                background: white;
                padding: 0;
            }
            .report-header {
                background: #7e57c2 !important;
                -webkit-print-color-adjust: exact;
            }
            th {
                background: #7e57c2 !important;
                -webkit-print-color-adjust: exact;
            }
        }
    </style>
</head>
<body>
    <div class="report-header">
        <h1>📊 Review Report</h1>
        <div class="subtitle">${fileName} | Generated on ${new Date().toLocaleString()}</div>
    </div>

    <div class="stats-container">
        <div class="stat-card">
            <div class="stat-value">${totalItems}</div>
            <div class="stat-label">Total Questions</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${masteredItems}</div>
            <div class="stat-label">Mastered</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${totalReviews}</div>
            <div class="stat-label">Review Sessions</div>
        </div>
    </div>

    <table>
        <thead>
            <tr>
                <th>ID</th>
                <th>Question</th>
                <th>Wrong Count</th>
                <th>Correct Count</th>
                <th>Review Count</th>
                <th>Mastered</th>
            </tr>
        </thead>
        <tbody>
`;

    // Add table rows
    items.forEach(item => {
        const question = escapeHtml(item.question);
        htmlContent += `
            <tr>
                <td>${item.id}</td>
                <td>${question}</td>
                <td class="error-count">${item._wrongCount}</td>
                <td class="correct-count">${item._correctCount}</td>
                <td>${item._reviewCount}</td>
                <td class="${item._mastered ? 'mastered-yes' : 'mastered-no'}">${item._mastered ? '✅ Yes' : '❌ No'}</td>
            </tr>`;
    });

    htmlContent += `
        </tbody>
    </table>

    <div class="footer">
        Generated by Reviewer Intense • ${new Date().toLocaleString()}
    </div>
</body>
</html>`;

    // Create and download the file
    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `review_report_${fileName.replace('.json', '')}_${new Date().getTime()}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Close the export menu after selection
    hideExportMenu();
}

function exportTxt(event) {
    if (event) {
        event.stopPropagation();
    }
    const data = loadReportData();
    if (!data) return;

    const { progressData } = data;
    const questionMap = new Map(progressData.questionMap);
    const items = Array.from(questionMap.values());

    // Sort by wrong count descending
    items.sort((a, b) => b._wrongCount - a._wrongCount);

    let txtContent = `Review Report - ${data.fileName}\n`;
    txtContent += `Generated on ${new Date().toLocaleString()}\n`;
    txtContent += '='.repeat(50) + '\n\n';

    items.forEach((item, index) => {
        txtContent += `[${index + 1}] ID: ${item.id}\n`;
        txtContent += `Question: ${item.question}\n`;
        txtContent += `Wrong: ${item._wrongCount} | Correct: ${item._correctCount} | Reviews: ${item._reviewCount} | Mastered: ${item._mastered ? 'Yes' : 'No'}\n`;
        txtContent += '-'.repeat(40) + '\n';
    });

    const blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `review_report_${data.fileName.replace('.json', '')}_${new Date().getTime()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Close the export menu after selection
    hideExportMenu();
}

function exportCsv(event) {
    if (event) {
        event.stopPropagation();
    }
    const data = loadReportData();
    if (!data) return;

    const { progressData } = data;
    const questionMap = new Map(progressData.questionMap);
    const items = Array.from(questionMap.values());

    // Sort by wrong count descending
    items.sort((a, b) => b._wrongCount - a._wrongCount);

    let csvContent = 'ID,Question,Wrong Count,Correct Count,Review Count,Mastered\n';
    items.forEach(item => {
        csvContent += `${csvEscape(item.id)},${csvEscape(item.question)},${item._wrongCount},${item._correctCount},${item._reviewCount},${item._mastered ? 'Yes' : 'No'}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `review_report_${data.fileName.replace('.json', '')}_${new Date().getTime()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Close the export menu after selection
    hideExportMenu();
}

function goBack() {
    const fileName = getReportUrlParam('file');
    if (fileName) {
        window.location.href = `/review?file=${encodeURIComponent(fileName)}`;
    } else {
        window.location.href = '/';
    }
}
