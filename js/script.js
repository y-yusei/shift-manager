document.addEventListener('DOMContentLoaded', function() {
    // --- ★★★ 修正点 ★★★ ---
    // エラーログに示されていた、正しいあなたのWorkerのURLに修正しました。
    const API_BASE_URL = 'https://my-shift-backend.tamago-2483.workers.dev'; 
    
    // --- グローバル変数 ---
    let dailyShiftChartInstance = null;
    let appState = { users: [], shifts: {}, manualBreaks: {}, manualShortages: {} };
    let currentUser = null; 

    // --- DOM要素 ---
    const mainViews = {
        calendar: document.getElementById('calendarView'),
        dailyChart: document.getElementById('dailyChartView'),
        bulkShift: document.getElementById('bulkShiftView'),
    };
    const navButtons = { 
        calendar: document.getElementById('showCalendarViewBtn'), 
        dailyChart: document.getElementById('showDailyChartViewBtn'), 
        bulkShift: document.getElementById('showBulkShiftViewBtn')
    };
    
    const shiftDetailModal = document.getElementById('shiftDetailModal');
    const modalContent = document.getElementById('modalContent');
    const roleSwitcher = document.getElementById('roleSwitcher');
    const currentUserInfo = document.getElementById('currentUserInfo');
    document.getElementById('currentYear').textContent = new Date().getFullYear();

    // カレンダービュー用
    const calendarGrid = document.getElementById('calendarGrid');
    const calendarMonthYear = document.getElementById('calendarMonthYear');
    const employeeHighlightSelect = document.getElementById('employeeHighlightSelect');
    const prevMonthBtn = document.getElementById('prevMonthBtn');
    const nextMonthBtn = document.getElementById('nextMonthBtn');

    // 日別グラフビュー用
    const dailyShiftChartCanvas = document.getElementById('dailyShiftChart');
    const currentChartDateInput = document.getElementById('currentChartDate');
    const prevDayChartBtn = document.getElementById('prevDayChartBtn');
    const nextDayChartBtn = document.getElementById('nextDayChartBtn');

    // 一括シフトビュー用
    const bulkShiftMonthYearDisplay = document.getElementById('bulkShiftMonthYear');
    const prevMonthBulkBtn = document.getElementById('prevMonthBulkBtn');
    const nextMonthBulkBtn = document.getElementById('nextMonthBulkBtn');
    const toggleBulkShiftPeriodBtn = document.getElementById('toggleBulkShiftPeriodBtn');
    const bulkShiftTable = document.getElementById('bulkShiftTable');

    // --- 表示管理用変数 ---
    let calendarDisplayDate = new Date(2025, 5, 1);
    let chartDisplayDate = new Date(2025, 5, 1);
    let bulkViewDisplayMonth = new Date(2025, 5, 1);
    let bulkViewIsFirstHalf = true;
    let selectedEmployeeForHighlight = null;
    const EMPLOYEE_VIEW_ID = 0;
    
    const dummyEvents = { 
        '2025-06-01': { text: '特売日', icon: 'fas fa-tags' },
        '2025-06-04': { text: '店長会議', icon: 'fas fa-users' },
        '2025-06-15': { text: '棚卸し', icon: 'fas fa-boxes-stacked' },
        '2025-06-20': { text: '新商品発売', icon: 'fas fa-gift' },
    };
    
    const dummyDataForOfflinePreview = {
        users: [
            { id: 1, name: '田中一郎', role: 'manager' }, { id: 2, name: '佐藤花子', role: 'employee' },
            { id: 3, name: '鈴木三郎', role: 'employee' }, { id: 4, name: '山田太郎', role: 'employee' },
            { id: 5, name: '高橋美咲', role: 'employee' }, { id: 6, name: '伊藤健太', role: 'employee' },
            { id: 7, name: '渡辺直子', role: 'employee' }, { id: 8, name: '山本敬子', role: 'employee' },
            { id: 9, name: '中村修平', role: 'employee' }, { id: 10, name: '小林明美', role: 'employee' },
            { id: 11, name: '加藤大輔', role: 'employee' },
        ],
        shifts: {
            '2025-06-01': [ { userId: 1, fullName: '田中一郎', time: '09:00 - 18:00', breakTime: '13:00 - 14:00', role: 'manager', notes: '週末対応' } ],
            '2025-06-02': [ { userId: 3, fullName: '鈴木三郎', time: '09:00 - 17:00', breakTime: '12:00 - 13:00', role: 'employee', notes: '早番' } ],
        },
        manualBreaks: {},
        manualShortages: {},
    };

    // --- データ通信 ---
    async function fetchDataForMonth(date) {
        const year = date.getFullYear();
        const month = ('0' + (date.getMonth() + 1)).slice(-2);
        try {
            const response = await fetch(`${API_BASE_URL}/api/data?month=${year}-${month}`);
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API Error: ${response.status} ${response.statusText} - ${errorText}`);
            }
            const data = await response.json();
            
            appState.users = data.users || [];
            const monthKey = `${year}-${month}`;
            Object.keys(appState.shifts).forEach(key => { if (key.startsWith(monthKey)) delete appState.shifts[key]; });
            Object.keys(appState.manualBreaks).forEach(key => { if (key.startsWith(monthKey)) delete appState.manualBreaks[key]; });
            Object.keys(appState.manualShortages).forEach(key => { if (key.startsWith(monthKey)) delete appState.manualShortages[key]; });

            appState.shifts = { ...appState.shifts, ...data.shifts };
            appState.manualBreaks = { ...appState.manualBreaks, ...data.manualBreaks };
            appState.manualShortages = { ...appState.manualShortages, ...data.manualShortages };
            
            if (!currentUser && appState.users.length > 0) { 
                initializeUser();
            }
            refreshCurrentView();
        } catch (error) {
            console.error("データ取得エラー:", error);
            alert("APIサーバーへの接続に失敗しました。ローカルのサンプルデータを表示します。");
            appState = { ...appState, ...dummyDataForOfflinePreview };
            if (!currentUser && appState.users.length > 0) {
                initializeUser();
            }
            refreshCurrentView();
        }
    }

    async function updateShift(shiftData) {
        try {
            const response = await fetch(`${API_BASE_URL}/api/shift`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(shiftData)
            });
            if (!response.ok) throw new Error('シフト更新APIエラー');
            return true;
        } catch (error) {
            console.error("シフト更新エラー:", error);
            alert("シフトの更新に失敗しました。");
            return false;
        }
    }
    
    async function updateManualData(date, breaks, shortages) {
        try {
            const payload = { date };
            if (breaks !== undefined) payload.breaks = breaks;
            if (shortages !== undefined) payload.shortages = shortages;

            const response = await fetch(`${API_BASE_URL}/api/manuals`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) throw new Error('手動データ更新APIエラー');
            return true;
        } catch (error) {
            console.error("手動データ更新エラー:", error);
            alert("情報の更新に失敗しました。");
            return false;
        }
    }
    
    // --- ユーティリティ関数 ---
    function formatTime(date) { return `${('0' + date.getHours()).slice(-2)}:${('0' + date.getMinutes()).slice(-2)}`; }
    function formatDate(date) { return `${date.getFullYear()}-${('0' + (date.getMonth() + 1)).slice(-2)}-${('0' + date.getDate()).slice(-2)}`; }
    function formatDateToJapanese(date) { return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 (${['日', '月', '火', '水', '木', '金', '土'][date.getDay()]})`; }
    function formatDateToJapaneseShort(date) { return `${date.getMonth() + 1}/${date.getDate()}(${['日', '月', '火', '水', '木', '金', '土'][date.getDay()]})`;}
    function isToday(date) { const today = new Date(); return date.toDateString() === today.toDateString(); }
    
    function parseTimeToDate(timeStr, baseDate) {
        if (!timeStr || !timeStr.includes(':')) return null;
        const [hours, minutes] = timeStr.split(':').map(Number);
        const date = new Date(baseDate);
        date.setHours(hours, minutes, 0, 0);
        return date;
    }

    // --- UI制御 ---
    function setActiveNavButton(activeViewKey) {
        Object.keys(navButtons).forEach(key => {
            const button = navButtons[key];
            button.classList.remove('active');
            if (key === activeViewKey) button.classList.add('active');
        });
    }

    async function switchView(viewKey) {
        Object.keys(mainViews).forEach(key => mainViews[key].classList.toggle('hidden', key !== viewKey));
        setActiveNavButton(viewKey);
        
        let targetDate;
        if (viewKey === 'calendar') targetDate = calendarDisplayDate;
        else if (viewKey === 'dailyChart') targetDate = chartDisplayDate;
        else if (viewKey === 'bulkShift') targetDate = bulkViewDisplayMonth;
        
        await fetchDataForMonth(targetDate);
    }
    
    function refreshCurrentView() {
        if (!mainViews.calendar.classList.contains('hidden')) renderCalendar();
        else if (!mainViews.dailyChart.classList.contains('hidden')) renderDailyShiftChart();
        else if (!mainViews.bulkShift.classList.contains('hidden')) renderBulkShiftTable();
    }

    // --- UI描画関数 ---
    function renderCalendar() {
        if (!calendarGrid || !calendarMonthYear || !employeeHighlightSelect) return; 

        calendarGrid.innerHTML = '';
        const year = calendarDisplayDate.getFullYear();
        const month = calendarDisplayDate.getMonth();
        calendarMonthYear.textContent = `${year}年 ${month + 1}月`;
        
        const currentSelected = employeeHighlightSelect.value;
        employeeHighlightSelect.innerHTML = `<option value="">全員表示</option>` + appState.users.map(u => `<option value="${u.id}">${u.name}</option>`).join('');
        employeeHighlightSelect.value = currentSelected;
        
        const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
        const startDayOfWeek = new Date(year, month, 1).getDay();

        for (let i = 0; i < startDayOfWeek; i++) {
            calendarGrid.insertAdjacentHTML('beforeend', `<div class="other-month"></div>`);
        }

        for (let day = 1; day <= lastDayOfMonth; day++) {
            const date = new Date(year, month, day);
            const dateString = formatDate(date);
            const dayCell = document.createElement('div');
            dayCell.className = 'calendar-day';
            if(isToday(date)) dayCell.classList.add('today');

            const shiftsForDay = appState.shifts[dateString] || [];
            if (selectedEmployeeForHighlight && shiftsForDay.some(s => s.userId === selectedEmployeeForHighlight)) {
                dayCell.classList.add('highlight-shift');
            }
            
            let cellContent = `<div class="calendar-day-header">${day}</div>`;
            const eventForDay = dummyEvents[dateString];
            if (eventForDay) {
                cellContent += `<div class="event-entry"><i class="${eventForDay.icon} mr-1"></i>${eventForDay.text}</div>`;
            }
            dayCell.innerHTML = cellContent;
            dayCell.addEventListener('click', () => showShiftDetailModal(date));
            calendarGrid.appendChild(dayCell);
        }
    }

    function renderDailyShiftChart() {
        if (!dailyShiftChartCanvas) return;
        const dateString = formatDate(chartDisplayDate);
        const shiftsForDay = appState.shifts[dateString] || [];
        
        const chartDatasetData = [];
        const yLabels = []; 

        shiftsForDay.forEach(shift => {
            if (!yLabels.includes(shift.fullName)) yLabels.push(shift.fullName);
            const mainStartDate = parseTimeToDate(shift.time.split(' - ')[0], chartDisplayDate);
            const mainEndDate = parseTimeToDate(shift.time.split(' - ')[1], chartDisplayDate);
            const bgColor = shift.role === 'manager' ? 'rgba(250, 204, 21, 0.7)' : 'rgba(59, 130, 246, 0.7)';
            if (!mainStartDate || !mainEndDate) return;

            if (shift.breakTime && shift.breakTime.includes(' - ')) {
                const breakStartDate = parseTimeToDate(shift.breakTime.split(' - ')[0], chartDisplayDate);
                const breakEndDate = parseTimeToDate(shift.breakTime.split(' - ')[1], chartDisplayDate);
                if (breakStartDate && breakEndDate && breakStartDate < mainEndDate && breakEndDate > mainStartDate && breakStartDate < breakEndDate) {
                    if (mainStartDate < breakStartDate) chartDatasetData.push({ x: [mainStartDate.getTime(), breakStartDate.getTime()], y: shift.fullName, originalShift: shift, bgColor: bgColor });
                    if (breakEndDate < mainEndDate) chartDatasetData.push({ x: [breakEndDate.getTime(), mainEndDate.getTime()], y: shift.fullName, originalShift: shift, bgColor: bgColor });
                } else { 
                    chartDatasetData.push({ x: [mainStartDate.getTime(), mainEndDate.getTime()], y: shift.fullName, originalShift: shift, bgColor: bgColor });
                }
            } else {
                chartDatasetData.push({ x: [mainStartDate.getTime(), mainEndDate.getTime()], y: shift.fullName, originalShift: shift, bgColor: bgColor });
            }
        });
        yLabels.sort();

        if (dailyShiftChartInstance) dailyShiftChartInstance.destroy();

        const todayForChart = new Date(chartDisplayDate);
        const chartMinTime = new Date(todayForChart); chartMinTime.setHours(9,0,0,0); 
        const chartMaxTime = new Date(todayForChart); chartMaxTime.setHours(21,0,0,0); 

        dailyShiftChartInstance = new Chart(dailyShiftChartCanvas, {
            type: 'bar',
            data: { datasets: [{ label: '勤務時間', data: chartDatasetData, backgroundColor: chartDatasetData.map(d => d.bgColor), borderColor: chartDatasetData.map(d => d.bgColor.replace('0.7', '1')), borderWidth: 1, barPercentage: 0.6, categoryPercentage: 0.7 }] },
            options: {
                indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                scales: {
                    x: { type: 'time', time: { unit: 'hour', displayFormats: { hour: '' }, tooltipFormat: '' }, min: chartMinTime.getTime(), max: chartMaxTime.getTime(), title: { display: true, text: '時間' } },
                    y: { type: 'category', labels: yLabels, title: { display: true, text: '従業員' }, offset: true }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const dp = context.dataset.data[context.dataIndex]; const os = dp.originalShift;
                                let l = `${formatTime(new Date(context.raw[0]))} - ${formatTime(new Date(context.raw[1]))}`;
                                if (os.notes) l += ` (備考: ${os.notes})`; if (os.breakTime) l += ` (休憩: ${os.breakTime})`;
                                return l;
                            },
                            title: (items) => items[0].label
                        }
                    }, legend: { display: false }
                }
            }
        });
    }

    function renderBulkShiftTable() {
        const dateHeader = bulkShiftTable.querySelector('thead tr');
        const body = bulkShiftTable.querySelector('tbody');
        const breakRow = bulkShiftTable.querySelector('tfoot #bulkShiftTableBreakTimesRow');
        const shortageRow = bulkShiftTable.querySelector('tfoot #bulkShiftTableShortageHoursRow');
        if(!dateHeader || !body || !breakRow || !shortageRow) return;

        dateHeader.innerHTML = '';
        body.innerHTML = '';
        breakRow.innerHTML = '';
        shortageRow.innerHTML = ''; 

        const days = [];
        let headerHtml = '<th>従業員名</th>';
        const year = bulkViewDisplayMonth.getFullYear();
        const month = bulkViewDisplayMonth.getMonth();
        const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
        
        const startDay = bulkViewIsFirstHalf ? 1 : 16;
        const endDayLoop = bulkViewIsFirstHalf ? 15 : lastDayOfMonth;

        for (let day = startDay; day <= endDayLoop; day++) {
            if (day > lastDayOfMonth) break; 
            const currentDate = new Date(year, month, day);
            days.push(formatDate(currentDate));
            headerHtml += `<th>${formatDateToJapaneseShort(currentDate)}</th>`;
        }
        dateHeader.innerHTML = headerHtml;
        
        const displayableUsers = [...appState.users.filter(u=>u.role === 'manager'), ...appState.users.filter(u=>u.role === 'employee')];

        displayableUsers.forEach(user => {
            let rowHtml = `<tr><th class="font-semibold ${user.role === 'manager' ? 'text-amber-700' : ''}">${user.name}</th>`;
            days.forEach((dateString) => {
                const shift = (appState.shifts[dateString] || []).find(s => s.userId === user.id);
                let shiftText = shift ? shift.time : "";
                if (currentUser.role === 'manager') {
                    rowHtml += `<td><input type="text" value="${shiftText}" data-user-id="${user.id}" data-date="${dateString}" placeholder=""></td>`;
                } else { rowHtml += `<td>${shiftText}</td>`; }
            });
            rowHtml += '</tr>';
            body.innerHTML += rowHtml;
        });
        
        let breakTimesRowHtml = '<tr><th class="font-semibold">休憩</th>'; 
        days.forEach(dateString => {
            const manuallyEnteredBreak = appState.manualBreaks[dateString] || '';
            if (currentUser.role === 'manager') {
                 breakTimesRowHtml += `<td><input type="text" class="break-time-input" value="${manuallyEnteredBreak}" placeholder="" data-date="${dateString}"></td>`;
            } else {
                breakTimesRowHtml += `<td class="break-time-display">${manuallyEnteredBreak || ''}</td>`; 
            }
        });
        breakRow.innerHTML = breakTimesRowHtml;

        let shortageRowHtml = '<tr><th class="font-semibold">不足</th>'; 
        days.forEach(dateString => {
            const manuallyEnteredShortage = appState.manualShortages[dateString] || '';
            if (currentUser.role === 'manager') {
                 shortageRowHtml += `<td><input type="text" class="shortage-input" value="${manuallyEnteredShortage}" placeholder="" data-date="${dateString}"></td>`;
            } else {
                shortageRowHtml += `<td class="shortage-input">${manuallyEnteredShortage || ''}</td>`; 
            }
        });
        shortageRow.innerHTML = shortageRowHtml;

        if (currentUser.role === 'manager') {
            body.querySelectorAll('input[type="text"]').forEach(input => input.addEventListener('change', handleBulkShiftInputChange));
            shortageRow.querySelectorAll('input[type="text"].shortage-input').forEach(input => input.addEventListener('change', handleManualShortageInputChange));
            breakRow.querySelectorAll('input[type="text"].break-time-input').forEach(input => input.addEventListener('change', handleManualBreakInputChange));
        }
        bulkShiftMonthYearDisplay.textContent = `${bulkViewDisplayMonth.getFullYear()}年 ${bulkViewDisplayMonth.getMonth() + 1}月`;
        toggleBulkShiftPeriodBtn.textContent = bulkViewIsFirstHalf ? '前半 (1-15日)' : `後半 (16-${lastDayOfMonth}日)`;
    }
    
    // --- イベントハンドラ ---
    function setupRoleSwitcher() {
        roleSwitcher.innerHTML = ''; 
        const managerUser = appState.users.find(u => u.role === 'manager');
        if (managerUser) {
             const optionManager = document.createElement('option');
             optionManager.value = managerUser.id;
             optionManager.textContent = `${managerUser.name} (店長)`;
             roleSwitcher.appendChild(optionManager);
        }
        const optionEmployeeView = document.createElement('option');
        optionEmployeeView.value = EMPLOYEE_VIEW_ID; 
        optionEmployeeView.textContent = "従業員ビュー";
        roleSwitcher.appendChild(optionEmployeeView);
        roleSwitcher.value = currentUser.id;
    }

    function updateUserInfo() {
         currentUserInfo.innerHTML = `表示モード: <span class="font-bold">${currentUser.name}</span>`;
    }
    
    function initializeUser() {
        const manager = appState.users.find(u => u.role === 'manager');
        currentUser = manager || { id: EMPLOYEE_VIEW_ID, name: '従業員ビュー', role: 'employee_viewer' };
        setupRoleSwitcher();
        updateUserInfo();
    }
    
    async function handleManualShortageInputChange(event) {
        const input = event.target;
        const date = input.dataset.date;
        const shortages = input.value.trim();
        if (await updateManualData(date, undefined, shortages)) {
            appState.manualShortages[date] = shortages;
        }
    }
    async function handleManualBreakInputChange(event) {
        const input = event.target;
        const date = input.dataset.date;
        const breaks = input.value.trim();
        if (await updateManualData(date, breaks, undefined)) {
            appState.manualBreaks[date] = breaks;
        }
    }
    async function handleBulkShiftInputChange(event) {
        const input = event.target;
        const userId = parseInt(input.dataset.userId);
        const date = input.dataset.date;
        const time = input.value.trim();
        const existingShift = (appState.shifts[date] || []).find(s => s.userId === userId);
        const shiftData = { userId, date, time, breakTime: existingShift?.breakTime, notes: existingShift?.notes };
        
        if (await updateShift(shiftData)) {
            await fetchDataForMonth(new Date(date));
        }
    }
    
    async function showShiftDetailModal(date) {
        modalContent.innerHTML = ''; 
        const dateString = formatDate(date);
        const shiftsForDay = appState.shifts[dateString] || [];

        let contentHtml = `<div class="flex justify-between items-start mb-4"><h3 class="text-2xl font-bold text-slate-700">${formatDateToJapanese(date)}</h3><button id="closeModalBtn" class="text-2xl text-slate-500 hover:text-slate-800">&times;</button></div>`;
        contentHtml += '<div class="mb-6"><h4 class="font-semibold text-lg text-slate-600 border-b pb-1 mb-3">確定シフト</h4>';
        if (shiftsForDay.length > 0) {
            shiftsForDay.forEach((s, index) => {
                contentHtml += `<div class="p-3 rounded-md mb-2 flex justify-between items-center ${s.role === 'manager' ? 'bg-yellow-100' : 'bg-blue-100'}"><div><p class="font-semibold ${s.role === 'manager' ? 'text-yellow-800' : 'text-blue-800'}">${s.fullName}</p><p class="text-sm ${s.role === 'manager' ? 'text-yellow-700' : 'text-blue-700'}">${s.time}</p>${s.breakTime ? `<p class="text-xs text-gray-500">休憩: ${s.breakTime}</p>` : ''}${s.notes ? `<p class="text-xs text-gray-600 mt-1">備考: ${s.notes}</p>` : ''}</div>${currentUser.role === 'manager' ? `<button class="delete-shift-btn" data-shift-index="${index}" data-date-string="${dateString}"><i class="fas fa-trash-alt"></i></button>` : ''}</div>`;
            });
        } else { contentHtml += '<p class="text-slate-500 text-sm">確定シフトはありません。</p>'; }
        contentHtml += '</div>';

        if (currentUser.role === 'manager') {
            contentHtml += `<div><h4 class="font-semibold text-lg text-slate-600 border-b pb-1 mb-3">新しいシフトを追加</h4><div class="space-y-3"><div><label for="newShiftEmployee" class="block text-sm font-medium text-slate-700 mb-1">従業員:</label><select id="newShiftEmployee" class="w-full p-2 border border-slate-300 rounded-md shadow-sm text-sm">${appState.users.map(u => `<option value="${u.id}">${u.name}</option>`).join('')}</select></div><div class="grid grid-cols-2 gap-3"><div><label for="newShiftStartTime" class="block text-sm font-medium text-slate-700 mb-1">勤務開始:</label><input type="time" id="newShiftStartTime" class="w-full p-2 border border-slate-300 rounded-md shadow-sm text-sm"></div><div><label for="newShiftEndTime" class="block text-sm font-medium text-slate-700 mb-1">勤務終了:</label><input type="time" id="newShiftEndTime" class="w-full p-2 border border-slate-300 rounded-md shadow-sm text-sm"></div></div><div class="grid grid-cols-2 gap-3"><div><label for="newBreakStartTime" class="block text-sm font-medium text-slate-700 mb-1">休憩開始 (任意):</label><input type="time" id="newBreakStartTime" class="w-full p-2 border border-slate-300 rounded-md shadow-sm text-sm"></div><div><label for="newBreakEndTime" class="block text-sm font-medium text-slate-700 mb-1">休憩終了 (任意):</label><input type="time" id="newBreakEndTime" class="w-full p-2 border border-slate-300 rounded-md shadow-sm text-sm"></div></div><div><label for="newShiftNotes" class="block text-sm font-medium text-slate-700 mb-1">備考 (任意):</label><input type="text" id="newShiftNotes" class="w-full p-2 border border-slate-300 rounded-md shadow-sm text-sm" placeholder="例: 早番リーダー"></div><button id="addShiftBtn" data-date-string="${dateString}" class="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-md transition"><i class="fas fa-plus-circle mr-1"></i> シフトを追加</button></div></div>`;
        } else if (currentUser.role === 'employee_viewer') { 
             contentHtml += '<p class="text-slate-500 text-sm">シフトの編集は店長が行います。</p>';
        }
        modalContent.innerHTML = contentHtml;
        document.getElementById('closeModalBtn').addEventListener('click', () => shiftDetailModal.style.display = 'none');
        
        if (currentUser.role === 'manager') {
            modalContent.querySelectorAll('.delete-shift-btn').forEach(button => {
                button.addEventListener('click', async (e) => {
                    const shiftIndex = parseInt(e.currentTarget.dataset.shiftIndex);
                    const targetDateString = e.currentTarget.dataset.dateString;
                    const shiftToDelete = (appState.shifts[targetDateString] || [])[shiftIndex];
                    if (shiftToDelete) {
                         if(await updateShift({ userId: shiftToDelete.userId, date: targetDateString, time: '' })) {
                            await fetchDataForMonth(date);
                            showShiftDetailModal(date);
                         }
                    }
                });
            });

            const addShiftBtn = modalContent.querySelector('#addShiftBtn');
            if(addShiftBtn) {
                addShiftBtn.addEventListener('click', async (e) => {
                    const employeeId = parseInt(modalContent.querySelector('#newShiftEmployee').value);
                    const startTime = modalContent.querySelector('#newShiftStartTime').value;
                    const endTime = modalContent.querySelector('#newShiftEndTime').value;
                    const breakStartTime = modalContent.querySelector('#newBreakStartTime').value;
                    const breakEndTime = modalContent.querySelector('#newBreakEndTime').value;
                    const notes = modalContent.querySelector('#newShiftNotes').value.trim();

                    if (!employeeId || !startTime || !endTime) { alert("従業員、勤務開始・終了時刻は必須です。"); return; }
                    if ((breakStartTime && !breakEndTime) || (!breakStartTime && breakEndTime)) { alert("休憩は開始・終了の両方を入力してください。"); return; }
                    
                    const shiftData = { date: dateString, userId: employeeId, time: `${startTime} - ${endTime}`, notes: notes };
                    if (breakStartTime && breakEndTime) shiftData.breakTime = `${breakStartTime} - ${breakEndTime}`;

                    if(await updateShift(shiftData)){
                        await fetchDataForMonth(date);
                        showShiftDetailModal(date);
                    }
                });
            }
        }
        shiftDetailModal.style.display = 'block';
    }
    

    // --- 初期化 ---
    async function initializeApp() {
        navButtons.calendar.addEventListener('click', () => switchView('calendar'));
        navButtons.dailyChart.addEventListener('click', () => switchView('dailyChart'));
        navButtons.bulkShift.addEventListener('click', () => switchView('bulkShift'));

        prevMonthBtn.addEventListener('click', async () => { calendarDisplayDate.setMonth(calendarDisplayDate.getMonth() - 1); await fetchDataForMonth(calendarDisplayDate); });
        nextMonthBtn.addEventListener('click', async () => { calendarDisplayDate.setMonth(calendarDisplayDate.getMonth() + 1); await fetchDataForMonth(calendarDisplayDate); });
        employeeHighlightSelect.addEventListener('change', (e) => { selectedEmployeeForHighlight = e.target.value ? parseInt(e.target.value) : null; renderCalendar(); });
        prevDayChartBtn.addEventListener('click', async () => { chartDisplayDate.setDate(chartDisplayDate.getDate() - 1); currentChartDateInput.value = formatDate(chartDisplayDate); await fetchDataForMonth(chartDisplayDate); });
        nextDayChartBtn.addEventListener('click', async () => { chartDisplayDate.setDate(chartDisplayDate.getDate() + 1); currentChartDateInput.value = formatDate(chartDisplayDate); await fetchDataForMonth(chartDisplayDate); });
        currentChartDateInput.addEventListener('change', async (e) => { chartDisplayDate = new Date(e.target.value + "T00:00:00"); await fetchDataForMonth(chartDisplayDate); });
        prevMonthBulkBtn.addEventListener('click', async () => { bulkViewDisplayMonth.setMonth(bulkViewDisplayMonth.getMonth() - 1); await fetchDataForMonth(bulkViewDisplayMonth); });
        nextMonthBulkBtn.addEventListener('click', async () => { bulkViewDisplayMonth.setMonth(bulkViewDisplayMonth.getMonth() + 1); await fetchDataForMonth(bulkViewDisplayMonth); });
        toggleBulkShiftPeriodBtn.addEventListener('click', () => { bulkViewIsFirstHalf = !bulkViewIsFirstHalf; renderBulkShiftTable(); });
        shiftDetailModal.addEventListener('click', (event) => { if (event.target === shiftDetailModal) shiftDetailModal.style.display = 'none'; });
        
        roleSwitcher.addEventListener('change', (e) => {
            const selectedId = parseInt(e.target.value);
            if (selectedId === EMPLOYEE_VIEW_ID) {
                currentUser = { id: EMPLOYEE_VIEW_ID, name: '従業員ビュー', role: 'employee_viewer' }; 
            } else {
                currentUser = appState.users.find(u => u.id === selectedId);
            }
            updateUserInfo();
            refreshCurrentView();
        });
        
        await fetchDataForMonth(new Date(2025, 5, 1));
        switchView('calendar');
    }
    
    initializeApp();
});
