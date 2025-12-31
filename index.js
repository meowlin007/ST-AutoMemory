// AutoMemory Extension - เวอร์ชันแก้ไขแล้ว
const AUTO_MEMORY_WORLD_INFO_FOLDER = "AutoMemory";
const FLOATING_BUTTON_ID = "autoMemoryFloatingBtn";
const MEMORY_PANEL_ID = "autoMemoryPanel";

// ตัวแปรสถานะ
let memoryEntries = [];
let messageCounter = 0;
let settings = {
    auto_memory_frequency: 5,
    memory_limit: 20,
    show_floating_button: true,
    auto_memory_world_info_folder: AUTO_MEMORY_WORLD_INFO_FOLDER
};

// เริ่มต้น Extension
async function extensionAutoMemory() {
    console.log("[AutoMemory] เริ่มการทำงาน...");
    
    // โหลดการตั้งค่า
    await loadSettings();
    
    // สร้าง UI
    if (settings.show_floating_button) {
        createFloatingButton();
    }
    
    // โหลด memories จาก World Info
    await loadMemories();
    
    // ฟังเหตุการณ์การส่งข้อความ
    document.addEventListener('messageSent', handleNewMessage);
    document.addEventListener('messageReceived', handleNewMessage);
    
    console.log("[AutoMemory] เริ่มทำงานเสร็จสมบูรณ์!");
}

// โหลดการตั้งค่าจาก localStorage
async function loadSettings() {
    try {
        const savedSettings = JSON.parse(localStorage.getItem('AutoMemory_settings')) || {};
        settings = { ...settings, ...savedSettings };
        console.log("[AutoMemory] โหลดการตั้งค่า:", settings);
    } catch (error) {
        console.error("[AutoMemory] ไม่สามารถโหลดการตั้งค่าได้:", error);
    }
}

// บันทึกการตั้งค่า
function saveSettings() {
    try {
        localStorage.setItem('AutoMemory_settings', JSON.stringify(settings));
        console.log("[AutoMemory] บันทึกการตั้งค่าแล้ว");
    } catch (error) {
        console.error("[AutoMemory] ไม่สามารถบันทึกการตั้งค่าได้:", error);
    }
}

// โหลด memories จาก World Info
async function loadMemories() {
    try {
        memoryEntries = [];
        
        // ใช้ API ของ SillyTavern เพื่อโหลด World Info
        const worldInfo = await callGeneric('world_info/get_all', {});
        
        if (worldInfo && worldInfo.entries) {
            // กรองเฉพาะ entries ที่อยู่ในโฟลเดอร์ AutoMemory
            memoryEntries = worldInfo.entries
                .filter(entry => 
                    entry.folder === settings.auto_memory_world_info_folder &&
                    entry.comment?.includes('AutoMemory')
                )
                .map(entry => ({
                    id: entry._id || entry.id,
                    content: entry.content,
                    keywords: Array.isArray(entry.key) ? entry.key : [entry.key],
                    timestamp: entry.comment?.split('|')[1]?.trim() || new Date().toISOString(),
                    character: entry.comment?.split('|')[0]?.replace('AutoMemory-', '') || 'unknown'
                }));
                
            console.log(`[AutoMemory] โหลด Memories แล้ว ${memoryEntries.length} รายการ`);
        }
    } catch (error) {
        console.error("[AutoMemory] ไม่สามารถโหลด Memories ได้:", error);
    }
}

// จัดการข้อความใหม่
async function handleNewMessage(event) {
    messageCounter++;
    const message = event.detail?.message || event.detail;
    
    // ตรวจสอบว่าถึงเวลาบันทึก memory หรือไม่
    if (messageCounter >= settings.auto_memory_frequency) {
        messageCounter = 0;
        await analyzeAndSaveMemory();
    }
    
    // สแกนหา memories ที่เกี่ยวข้องกับข้อความนี้
    await scanForRelevantMemories(message);
}

// วิเคราะห์และบันทึก memory
async function analyzeAndSaveMemory() {
    try {
        // ดึงประวัติการแชทล่าสุด
        const chatHistory = await callGeneric('chat/get_history', {});
        if (!chatHistory || !chatHistory.chat || chatHistory.chat.length < 3) return;
        
        // ใช้ข้อความล่าสุด 10 ข้อความ
        const recentMessages = chatHistory.chat.slice(-10);
        const characterName = chatHistory.character?.name || "ตัวละคร";
        
        // สร้าง prompt สำหรับ AI
        const prompt = `คุณเป็นผู้ช่วยจดจำความทรงจำ วิเคราะห์บทสนทนาด้านล่างและดึงข้อมูลสำคัญที่ตัวละครควรจดจำเกี่ยวกับผู้ใช้
ให้สรุปเป็นประโยคสั้นๆ ในรูปแบบ "ผู้ใช้ + ข้อมูลที่ควรจดจำ" ใช้คำว่า "ผู้ใช้" เสมอ
ให้โฟกัสเฉพาะข้อมูลที่เกี่ยวข้องกับความชอบ สิ่งที่ผู้ใช้บอก หรือเรื่องสำคัญที่เกิดขึ้น
ถ้าไม่มีข้อมูลสำคัญที่ควรจดจำ ให้ตอบว่า "ไม่มีข้อมูลสำคัญ"

ตัวอย่าง:
- ผู้ใช้ชอบกินขนมปังรสสังขยา
- ผู้ใช้เลี้ยงแมวชื่อเหมียว
- ผู้ใช้ทำงานเป็นโปรแกรมเมอร์

บทสนทนาล่าสุด:
${recentMessages.map(msg => `${msg.name || 'Unknown'}: ${msg.mes}`).join('\n')}
`;

        // ใช้ slash command /gen เพื่อสร้างข้อความในแบ็คกราวน์
        const aiResponse = await executeSlashCommandsWithOptions(
            `/gen silent "${prompt}"`
        );
        
        if (!aiResponse || aiResponse.includes("ไม่มีข้อมูลสำคัญ")) {
            console.log("[AutoMemory] ไม่พบข้อมูลสำคัญที่ควรจดจำ");
            return;
        }
        
        // แยกแต่ละ memory ถ้ามีหลายอัน
        const memories = aiResponse.split('\n')
            .filter(line => line.trim() && !line.includes("ไม่มีข้อมูลสำคัญ"))
            .map(line => line.trim());
        
        for (const memoryText of memories) {
            if (memoryText) {
                // ดึง keyword จาก memory
                const keywords = extractKeywords(memoryText);
                
                // บันทึก memory
                await saveMemory(memoryText, keywords, characterName);
            }
        }
        
    } catch (error) {
        console.error("[AutoMemory] ไม่สามารถวิเคราะห์ memory ได้:", error);
        showToast("เกิดข้อผิดพลาดในการวิเคราะห์ความทรงจำ", "error");
    }
}

// สแกนหา memories ที่เกี่ยวข้อง
async function scanForRelevantMemories(message) {
    if (!memoryEntries.length || !message) return;
    
    const keywords = extractKeywords(message.mes || message);
    if (keywords.length === 0) return;
    
    // ค้นหา memories ที่ตรงกับ keyword
    const relevantMemories = memoryEntries.filter(memory => {
        return keywords.some(keyword => 
            memory.keywords.some(kw => 
                keyword.toLowerCase().includes(kw.toLowerCase()) ||
                kw.toLowerCase().includes(keyword.toLowerCase())
            )
        );
    });
    
    if (relevantMemories.length > 0) {
        console.log(`[AutoMemory] พบ Memories ที่เกี่ยวข้อง: ${relevantMemories.length} รายการ`);
        
        // แทรก memories ที่เกี่ยวข้องเข้าไปใน context
        const memoryContext = relevantMemories.map(mem => 
            `[ความทรงจำ]: ${mem.content}`
        ).join('\n');
        
        // เพิ่มเข้าไปใน context ของ chat
        await callGeneric('context/add', {
            context: memoryContext,
            position: 'before_prompt'
        });
    }
}

// ดึง keyword จากข้อความ
function extractKeywords(text) {
    if (!text || typeof text !== 'string') return [];
    
    // ลบเครื่องหมายวรรคตอนและตัวเลข
    const cleanText = text.replace(/[^\w\sก-๙]/g, '').replace(/\d+/g, '');
    
    // แบ่งคำ
    const words = cleanText.split(/\s+/).filter(word => word.length > 0);
    
    // กรองคำที่ไม่สำคัญ
    const stopWords = ['และ', 'หรือ', 'แต่', 'ของ', 'ที่', 'ใน', 'บน', 'กับ', 'เป็น', 'ได้', 'มี', 'ให้', 'ไป', 'มา', 
                      'นะ', 'ครับ', 'ค่ะ', 'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 
                      'is', 'are', 'was', 'were', 'be', 'been', 'ผู้ใช้', 'เขา', 'เธอ', 'ฉัน', 'ผม', 'ดิฉัน', 'มัน'];
    
    return words
        .map(word => word.trim().toLowerCase())
        .filter(word => word.length > 2 && !stopWords.includes(word))
        .slice(0, 5); // จำกัดที่ 5 keyword
}

// บันทึก memory ใหม่
async function saveMemory(content, keywords, characterName) {
    try {
        // ตรวจสอบว่ามี memory ซ้ำหรือไม่
        const isDuplicate = memoryEntries.some(entry => 
            entry.content.toLowerCase() === content.toLowerCase()
        );
        
        if (isDuplicate) {
            console.log("[AutoMemory] Memory นี้มีอยู่แล้ว:", content);
            return;
        }
        
        // สร้าง entry สำหรับ World Info
        const timestamp = new Date().toISOString();
        const comment = `AutoMemory-${characterName} | ${timestamp}`;
        
        const worldInfoEntry = {
            comment: comment,
            key: keywords,
            content: content,
            folder: settings.auto_memory_world_info_folder,
            selective: true,
            secondary_keys: [],
            constant: false,
            position: 0,
            exclude_recursion: false,
            probability_presence: 100,
            probability_match: 100
        };
        
        // บันทึกใน World Info
        const result = await callGeneric('world_info/create', worldInfoEntry);
        
        if (result?.success) {
            // เพิ่มในรายการ memories
            memoryEntries.unshift({
                id: result.id,
                content: content,
                keywords: keywords,
                timestamp: timestamp,
                character: characterName
            });
            
            // จำกัดจำนวน memories
            if (memoryEntries.length > settings.memory_limit) {
                const oldest = memoryEntries.pop();
                await callGeneric('world_info/delete', { id: oldest.id });
            }
            
            console.log("[AutoMemory] บันทึก Memory ใหม่:", content);
            showToast(`บันทึกความทรงจำ: ${content}`);
            
            // อัปเดท UI
            if (document.getElementById(MEMORY_PANEL_ID)?.classList.contains('visible')) {
                refreshMemoryPanel();
            }
        } else {
            throw new Error("ไม่สามารถบันทึกใน World Info ได้");
        }
        
    } catch (error) {
        console.error("[AutoMemory] ไม่สามารถบันทึก memory ได้:", error);
        showToast("เกิดข้อผิดพลาดในการบันทึกความทรงจำ", "error");
        
        // บันทึกลง localStorage เป็น backup
        saveToLocalStorage(content, keywords, characterName);
    }
}

// บันทึกใน localStorage เป็น backup
function saveToLocalStorage(content, keywords, characterName) {
    try {
        const backupMemories = JSON.parse(localStorage.getItem('AutoMemory_backup')) || [];
        
        backupMemories.unshift({
            content: content,
            keywords: keywords,
            character: characterName,
            timestamp: new Date().toISOString(),
            status: 'failed'
        });
        
        // จำกัดที่ 50 รายการ
        if (backupMemories.length > 50) {
            backupMemories.pop();
        }
        
        localStorage.setItem('AutoMemory_backup', JSON.stringify(backupMemories));
        console.log("[AutoMemory] บันทึกใน localStorage สำรองแล้ว");
    } catch (error) {
        console.error("[AutoMemory] ไม่สามารถบันทึกใน localStorage ได้:", error);
    }
}

// สร้างปุ่มลอยตัว
function createFloatingButton() {
    // ลบปุ่มเก่าถ้ามี
    const existingBtn = document.getElementById(FLOATING_BUTTON_ID);
    if (existingBtn) existingBtn.remove();
    
    // โหลดสไตล์
    loadFloatingButtonStyle();
    
    // สร้างปุ่ม
    const btn = document.createElement('div');
    btn.id = FLOATING_BUTTON_ID;
    btn.className = 'diary-float-window';
    btn.innerHTML = `
        <div class="diary-float-content">
            <span>🧠</span>
        </div>
        <div class="diary-menu">
            <div class="diary-menu-item" id="openMemoryPanel">
                <span>📖</span> ความทรงจำ
            </div>
            <div class="diary-menu-item" id="manualSaveMemory">
                <span>✏️</span> บันทึกเอง
            </div>
            <div class="diary-menu-item" id="clearAllMemories">
                <span>🗑️</span> ล้างทั้งหมด
            </div>
        </div>
    `;
    document.body.appendChild(btn);
    
    // เหตุการณ์สำหรับปุ่ม
    btn.addEventListener('click', (e) => {
        if (e.target === btn || e.target.closest('.diary-float-content')) {
            btn.classList.toggle('expanded');
        }
    });
    
    // ปุ่มในเมนู
    document.getElementById('openMemoryPanel').addEventListener('click', () => {
        openMemoryPanel();
        btn.classList.remove('expanded');
    });
    
    document.getElementById('manualSaveMemory').addEventListener('click', () => {
        manualSaveMemory();
        btn.classList.remove('expanded');
    });
    
    document.getElementById('clearAllMemories').addEventListener('click', async () => {
        if (confirm('คุณแน่ใจหรือไม่ว่าต้องการล้างความทรงจำทั้งหมด?')) {
            await clearAllMemories();
        }
        btn.classList.remove('expanded');
    });
    
    // ทำให้ปุ่มลอยตัวลากได้
    makeDraggable(btn);
    
    console.log("[AutoMemory] สร้างปุ่มลอยตัวแล้ว");
}

// โหลดสไตล์สำหรับปุ่มลอยตัว
function loadFloatingButtonStyle() {
    const styleId = 'autoMemoryFloatingStyle';
    if (document.getElementById(styleId)) return;
    
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
        #${FLOATING_BUTTON_ID} {
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 60px;
            height: 60px;
            border-radius: 50%;
            background: linear-gradient(135deg, #6a11cb 0%, #2575fc 100%);
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 24px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.3);
            cursor: grab;
            z-index: 9999;
            transition: all 0.3s ease;
            user-select: none;
        }
        
        #${FLOATING_BUTTON_ID}:hover {
            transform: scale(1.1);
            box-shadow: 0 6px 20px rgba(0,0,0,0.4);
        }
        
        #${FLOATING_BUTTON_ID}.expanded {
            border-radius: 20px;
            width: 200px;
            height: 60px;
        }
        
        .diary-float-content {
            position: absolute;
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: opacity 0.3s ease;
        }
        
        #${FLOATING_BUTTON_ID}.expanded .diary-float-content {
            opacity: 0;
        }
        
        .diary-menu {
            display: flex;
            gap: 10px;
            opacity: 0;
            transition: opacity 0.3s ease;
        }
        
        #${FLOATING_BUTTON_ID}.expanded .diary-menu {
            opacity: 1;
        }
        
        .diary-menu-item {
            display: flex;
            align-items: center;
            gap: 5px;
            color: white;
            font-size: 14px;
            cursor: pointer;
            padding: 5px 10px;
            border-radius: 15px;
            background: rgba(255,255,255,0.1);
            transition: all 0.2s ease;
        }
        
        .diary-menu-item:hover {
            background: rgba(255,255,255,0.2);
            transform: scale(1.05);
        }
        
        #${MEMORY_PANEL_ID} {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            min-width: 300px;
            max-width: 90%;
            max-height: 90vh;
            background: #2d2d3a;
            border-radius: 15px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.4);
            z-index: 10000;
            display: none;
            flex-direction: column;
            overflow: hidden;
            border: 1px solid #444;
        }
        
        #${MEMORY_PANEL_ID}.visible {
            display: flex;
        }
        
        .diary-panel-header {
            background: linear-gradient(135deg, #3a3a4a 0%, #2d2d3a 100%);
            padding: 15px 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid #444;
        }
        
        .diary-panel-title {
            color: #ffd700;
            font-size: 1.2em;
            font-weight: bold;
        }
        
        .diary-panel-close {
            background: #ff4d4d;
            color: white;
            border: none;
            width: 28px;
            height: 28px;
            border-radius: 50%;
            cursor: pointer;
            font-weight: bold;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
        }
        
        .diary-panel-close:hover {
            background: #ff1a1a;
            transform: scale(1.1);
        }
        
        .diary-panel-content {
            flex: 1;
            padding: 15px;
            overflow-y: auto;
            color: #e0e0e0;
        }
        
        .memory-entry {
            background: #3a3a4a;
            border-radius: 10px;
            padding: 15px;
            margin-bottom: 12px;
            transition: all 0.2s ease;
            border-left: 4px solid #6a11cb;
        }
        
        .memory-entry:hover {
            background: #424255;
            transform: translateX(5px);
            box-shadow: 0 3px 10px rgba(0,0,0,0.2);
        }
        
        .memory-content {
            margin-bottom: 8px;
            line-height: 1.5;
        }
        
        .memory-character {
            font-size: 0.9em;
            color: #a8a8e0;
            margin-bottom: 5px;
        }
        
        .memory-keywords {
            font-size: 0.8em;
            color: #88cc88;
        }
        
        .memory-timestamp {
            font-size: 0.75em;
            color: #aaa;
            margin-top: 5px;
        }
        
        .memory-actions {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            margin-top: 10px;
        }
        
        .memory-btn {
            padding: 4px 10px;
            border-radius: 5px;
            border: none;
            cursor: pointer;
            font-size: 0.85em;
            transition: all 0.2s ease;
        }
        
        .memory-btn.delete {
            background: #ff4d4d;
            color: white;
        }
        
        .memory-btn.edit {
            background: #3a86ff;
            color: white;
        }
        
        .no-memories {
            text-align: center;
            color: #aaa;
            padding: 30px;
            font-style: italic;
            font-size: 1.1em;
        }
        
        .toast-notification {
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            padding: 12px 25px;
            border-radius: 25px;
            color: white;
            font-weight: bold;
            box-shadow: 0 5px 15px rgba(0,0,0,0.3);
            z-index: 99999;
            animation: slideIn 0.3s, fadeOut 0.5s 2s forwards;
        }
        
        .toast-success {
            background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
        }
        
        .toast-error {
            background: linear-gradient(135deg, #dc3545 0%, #ff6b6b 100%);
        }
        
        @keyframes slideIn {
            from { transform: translate(-50%, 100%); opacity: 0; }
            to { transform: translate(-50%, 0); opacity: 1; }
        }
        
        @keyframes fadeOut {
            from { opacity: 1; }
            to { opacity: 0; transform: translate(-50%, 100%); }
        }
        
        @media (max-width: 768px) {
            #${FLOATING_BUTTON_ID} {
                width: 50px;
                height: 50px;
                font-size: 20px;
            }
            
            #${FLOATING_BUTTON_ID}.expanded {
                width: calc(100% - 40px);
                left: 20px;
                right: auto;
                border-radius: 15px;
            }
            
            .diary-menu {
                flex-wrap: wrap;
                justify-content: center;
            }
            
            .diary-menu-item {
                font-size: 12px;
                padding: 4px 8        "เธอชอบกินขนมปังรสสังขยา",
        "เธอชอบดื่มกาแฟร้อนตอนเช้า",
        "เธอเลี้ยงแมวชื่อเหมียว"
    ];
    
    const randomMemory = sampleMemories[Math.floor(Math.random() * sampleMemories.length)];
    const keywords = extractKeywords(randomMemory);
    
    addMemoryEntry(randomMemory, keywords);
    showToast(`บันทึกความทรงจำใหม่: ${randomMemory}`);
    
    // อัปเดท UI
    refreshMemoryPanel();
}

// เพิ่มความทรงจำเข้ารายการ
function addMemoryEntry(content, keywords) {
    const newEntry = {
        id: Date.now().toString(),
        content: content,
        keywords: keywords,
        timestamp: new Date().toISOString()
    };
    
    memoryEntries.unshift(newEntry);
    
    // จำกัดจำนวน
    if (memoryEntries.length > 20) {
        memoryEntries.pop();
    }
}

// ดึง keyword (เวอร์ชันง่าย)
function extractKeywords(text) {
    const words = text.split(/\s+/);
    return words.filter(word => word.length > 2 && !['เธอ', 'เขา', 'มัน', 'ฉัน', 'คุณ'].includes(word));
}

// สร้างปุ่มลอยตัว (เหมือนเดิมแต่แก้ไขให้ทำงานได้ทันที)
function createFloatingButton() {
    // ลบปุ่มเก่าถ้ามี
    const existingBtn = document.getElementById('autoMemoryFloatingBtn');
    if (existingBtn) existingBtn.remove();
    
    // สร้างสไตล์
    const style = document.createElement('style');
    style.textContent = `
        #autoMemoryFloatingBtn {
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 50px;
            height: 50px;
            border-radius: 50%;
            background: #6a11cb;
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            box-shadow: 0 3px 10px rgba(0,0,0,0.3);
            cursor: pointer;
            z-index: 9999;
        }
        #autoMemoryFloatingBtn:hover {
            background: #5a00b0;
        }
        #autoMemoryPanel {
            position: fixed;
            bottom: 80px;
            right: 20px;
            width: 280px;
            max-height: 70vh;
            background: #2d2d3a;
            border-radius: 10px;
            box-shadow: 0 5px 20px rgba(0,0,0,0.4);
            padding: 15px;
            z-index: 9998;
            display: none;
            color: white;
            overflow-y: auto;
        }
        #autoMemoryPanel.visible {
            display: block;
        }
    `;
    document.head.appendChild(style);
    
    // สร้างปุ่ม
    const btn = document.createElement('div');
    btn.id = 'autoMemoryFloatingBtn';
    btn.innerHTML = '🧠';
    document.body.appendChild(btn);
    
    // สร้าง panel
    const panel = document.createElement('div');
    panel.id = 'autoMemoryPanel';
    panel.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <h3 style="margin: 0; color: #ffd700;">ความทรงจำของฉัน</h3>
            <span id="closeMemoryPanel" style="cursor: pointer; font-weight: bold;">×</span>
        </div>
        <div id="memoryList" style="max-height: 60vh; overflow-y: auto;">
            <p style="text-align: center; color: #aaa;">ยังไม่มีความทรงจำ</p>
        </div>
    `;
    document.body.appendChild(panel);
    
    // เหตุการณ์
    btn.addEventListener('click', () => {
        panel.classList.toggle('visible');
        if (panel.classList.contains('visible')) {
            refreshMemoryPanel();
        }
    });
    
    document.getElementById('closeMemoryPanel').addEventListener('click', () => {
        panel.classList.remove('visible');
    });
    
    console.log("ปุ่มลอยตัวสร้างแล้ว!");
}

// อัปเดท panel แสดงความทรงจำ
function refreshMemoryPanel() {
    const list = document.getElementById('memoryList');
    
    if (memoryEntries.length === 0) {
        list.innerHTML = '<p style="text-align: center; color: #aaa;">ยังไม่มีความทรงจำ</p>';
        return;
    }
    
    let html = '';
    memoryEntries.forEach((mem, i) => {
        html += `
            <div style="background: #3a3a4a; border-radius: 8px; padding: 10px; margin-bottom: 8px;">
                <div style="font-weight: bold; color: #ffd700;">ความทรงจำ #${i+1}</div>
                <div>${mem.content}</div>
                <div style="font-size: 0.8em; color: #a8a8e0; margin-top: 5px;">Keywords: ${mem.keywords.join(', ')}</div>
                <div style="font-size: 0.7em; color: #888; margin-top: 3px;">${new Date(mem.timestamp).toLocaleTimeString('th-TH')}</div>
            </div>
        `;
    });
    
    list.innerHTML = html;
}

// แสดงการแจ้งเตือน
function showToast(message) {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(45, 180, 80, 0.9);
        color: white;
        padding: 10px 20px;
        border-radius: 25px;
        box-shadow: 0 3px 10px rgba(0,0,0,0.3);
        z-index: 99999;
        font-weight: bold;
        animation: slideIn 0.3s, fadeOut 0.5s 2s forwards;
    `;
    toast.innerHTML = message;
    
    const keyframes = `
        @keyframes slideIn {
            from { opacity: 0; transform: translate(-50%, 100%); }
            to { opacity: 1; transform: translate(-50%, 0); }
        }
        @keyframes fadeOut {
            from { opacity: 1; }
            to { opacity: 0; transform: translate(-50%, 100%); }
        }
    `;
    
    const style = document.createElement('style');
    style.textContent = keyframes;
    document.head.appendChild(style);
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.remove();
        style.remove();
    }, 2500);
}

// เริ่มต้นเมื่อเอกสารโหลดเสร็จ
document.addEventListener('DOMContentLoaded', () => {
    // ตรวจสอบว่าโหลดในหน้าแชทเท่านั้น
    if (window.location.pathname.includes('/chat')) {
        extensionAutoMemory();
    }
});

console.log("AutoMemory Extension โหลดแล้ว!");    } catch (error) {
        console.error("ไม่สามารถโหลดการตั้งค่าได้:", error);
        return defaultSettings;
    }
}

// โหลด memory จาก world info
async function loadMemories() {
    try {
        const worldInfo = await loadWorldInfo();
        if (!worldInfo) return;
        
        // หา entries ที่เป็นของ AutoMemory
        memoryEntries = worldInfo.entries.filter(entry => 
            entry.key?.includes('AutoMemory') || 
            entry.comment?.includes('AutoMemory')
        ).map(entry => ({
            id: entry._id || Date.now().toString(),
            content: entry.content,
            keywords: entry.key || [],
            timestamp: new Date().toISOString(),
            lastUsed: new Date().toISOString()
        }));
        
        console.log("โหลด Memory แล้ว:", memoryEntries.length);
    } catch (error) {
        console.error("ไม่สามารถโหลด Memory ได้:", error);
    }
}

// จัดการข้อความใหม่
async function handleNewMessage(event) {
    messageCounter++;
    
    // ตรวจสอบว่าถึงเวลาบันทึก memory หรือไม่
    if (messageCounter >= autoMemorySettings.auto_memory_frequency) {
        messageCounter = 0;
        await analyzeAndSaveMemory();
    }
    
    // สแกนหา keyword ใน memory เพื่อใช้ตอบกลับ
    await scanForRelevantMemories(event.detail.message);
}

// วิเคราะห์และบันทึก memory
async function analyzeAndSaveMemory() {
    try {
        const chatHistory = getChatHistory();
        if (!chatHistory || chatHistory.length < 3) return;
        
        // ใช้ AI วิเคราะห์สิ่งที่ควรจดจำ
        const prompt = `วิเคราะห์บทสนทนาด้านล่างและระบุข้อมูลสำคัญที่ตัวละครควรจดจำเกี่ยวกับผู้ใช้หรือเรื่องราวที่เกิดขึ้น 
        ให้สรุปเป็นประโยคสั้นๆ ในรูปแบบ "เขา/เธอ/ผู้ใช้ + ข้อมูลที่ควรจดจำ"
        หากไม่มีข้อมูลสำคัญที่ควรจดจำ ให้ตอบว่า "ไม่มีข้อมูลสำคัญ"

        บทสนทนา:
        ${chatHistory.slice(-10).map(msg => `${msg.name}: ${msg.mes}`).join('\n')}`;
        
        const aiResponse = await generateText(prompt);
        
        if (aiResponse && !aiResponse.includes("ไม่มีข้อมูลสำคัญ")) {
            // แยกแต่ละ memory ถ้ามีหลายอัน
            const memories = aiResponse.split('\n').filter(line => line.trim() && !line.includes("ไม่มีข้อมูลสำคัญ"));
            
            for (const memoryText of memories) {
                if (memoryText.trim()) {
                    // ดึง keyword จาก memory
                    const keywords = extractKeywords(memoryText);
                    
                    // บันทึก memory
                    await saveMemory(memoryText.trim(), keywords);
                }
            }
        }
    } catch (error) {
        console.error("ไม่สามารถวิเคราะห์ memory ได้:", error);
    }
}

// สแกนหา memory ที่เกี่ยวข้อง
async function scanForRelevantMemories(message) {
    if (!memoryEntries.length || !message) return;
    
    const keywords = extractKeywords(message);
    if (keywords.length === 0) return;
    
    // ค้นหา memory ที่ตรงกับ keyword
    const relevantMemories = memoryEntries.filter(memory => {
        return keywords.some(keyword => 
            memory.keywords.some(kw => 
                keyword.toLowerCase().includes(kw.toLowerCase()) ||
                kw.toLowerCase().includes(keyword.toLowerCase())
            )
        );
    });
    
    // อัพเดทเวลาที่ใช้ล่าสุด
    relevantMemories.forEach(memory => {
        memory.lastUsed = new Date().toISOString();
    });
    
    if (relevantMemories.length > 0) {
        console.log("พบ Memory ที่เกี่ยวข้อง:", relevantMemories);
        // แทรก memory ที่เกี่ยวข้องเข้าไปใน context
        insertRelevantMemoriesIntoContext(relevantMemories);
    }
}

// ดึง keyword จากข้อความ
function extractKeywords(text) {
    if (!text) return [];
    
    // ลบเครื่องหมายวรรคตอน
    const cleanText = text.replace(/[^\w\sก-๙]/g, '');
    
    // แบ่งคำ
    const words = cleanText.split(/\s+/);
    
    // กรองคำที่ไม่สำคัญ
    const stopWords = ['และ', 'หรือ', 'แต่', 'ของ', 'ที่', 'ใน', 'บน', 'กับ', 'เป็น', 'ได้', 'มี', 'ให้', 'ไป', 'มา', 'นะ', 'ครับ', 'ค่ะ', 'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been'];
    
    return words
        .map(word => word.trim().toLowerCase())
        .filter(word => word.length > 2 && !stopWords.includes(word));
}

// บันทึก memory ใหม่
async function saveMemory(content, keywords) {
    // ตรวจสอบว่ามี memory ซ้ำหรือไม่
    const isDuplicate = memoryEntries.some(entry => 
        entry.content.toLowerCase() === content.toLowerCase()
    );
    
    if (isDuplicate) {
        console.log("Memory นี้มีอยู่แล้ว:", content);
        return;
    }
    
    // สร้าง memory entry ใหม่
    const newEntry = {
        id: Date.now().toString(),
        content: content,
        keywords: keywords,
        timestamp: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
        importance: 1.0
    };
    
    // เพิ่ม memory ใหม่
    memoryEntries.unshift(newEntry);
    
    // จำกัดจำนวน memory
    if (memoryEntries.length > autoMemorySettings.memory_limit) {
        memoryEntries.pop();
    }
    
    // บันทึกใน World Info
    await saveToWorldInfo(newEntry);
    
    console.log("บันทึก Memory ใหม่:", newEntry);
    showToast(`บันทึกความทรงจำ: ${content}`);
}

// บันทึกใน World Info
async function saveToWorldInfo(memoryEntry) {
    try {
        const entry = {
            comment: `AutoMemory-${memoryEntry.id}`,
            key: memoryEntry.keywords,
            content: memoryEntry.content,
            folder: MEMORY_WORLD_INFO_NAME,
            selective: true,
            secondary_keys: [],
            constant: false,
            position: 0,
            exclude_recursion: false,
            probability_presence: 100,
            probability_match: 100
        };
        
        await createWorldInfoEntry(entry);
    } catch (error) {
        console.error("ไม่สามารถบันทึกใน World Info ได้:", error);
    }
}

// สร้างปุ่มลอยตัว
function createFloatingButton() {
    // โหลดสไตล์สำหรับปุ่มลอยตัว
    injectStyles(`
        #autoMemoryFloatingBtn {
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 60px;
            height: 60px;
            border-radius: 50%;
            background: linear-gradient(135deg, #6a11cb 0%, #2575fc 100%);
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 24px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.3);
            cursor: pointer;
            z-index: 9999;
            transition: all 0.3s ease;
        }
        
        #autoMemoryFloatingBtn:hover {
            transform: scale(1.1);
            box-shadow: 0 6px 20px rgba(0,0,0,0.4);
        }
        
        #autoMemoryPanel {
            position: fixed;
            bottom: 90px;
            right: 20px;
            width: 300px;
            max-height: 80vh;
            background: #2d2d3a;
            border-radius: 12px;
            box-shadow: 0 5px 25px rgba(0,0,0,0.4);
            padding: 15px;
            z-index: 9998;
            display: none;
            flex-direction: column;
            overflow: hidden;
        }
        
        #autoMemoryPanel.visible {
            display: flex;
        }
        
        .autoMemory-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding-bottom: 10px;
            border-bottom: 1px solid #444;
            margin-bottom: 10px;
        }
        
        .autoMemory-content {
            flex: 1;
            overflow-y: auto;
            color: #e0e0e0;
        }
        
        .autoMemory-entry {
            background: #3a3a4a;
            border-radius: 8px;
            padding: 10px;
            margin-bottom: 8px;
            transition: all 0.2s;
        }
        
        .autoMemory-entry:hover {
            background: #424255;
            transform: translateX(5px);
        }
        
        .autoMemory-keywords {
            font-size: 0.8em;
            color: #a8a8e0;
            margin-top: 5px;
        }
        
        .autoMemory-actions {
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            margin-top: 10px;
        }
        
        .autoMemory-btn {
            padding: 5px 10px;
            border-radius: 5px;
            border: none;
            cursor: pointer;
            font-weight: bold;
        }
        
        .autoMemory-btn.refresh {
            background: #3a86ff;
            color: white;
        }
        
        .autoMemory-btn.clear {
            background: #ff4d4d;
            color: white;
        }
    `);
    
    // สร้างปุ่มลอยตัว
    let floatingBtn = document.createElement('div');
    floatingBtn.id = 'autoMemoryFloatingBtn';
    floatingBtn.innerHTML = '🧠';
    document.body.appendChild(floatingBtn);
    
    // สร้าง panel สำหรับแสดง memory
    let panel = document.createElement('div');
    panel.id = 'autoMemoryPanel';
    panel.innerHTML = `
        <div class="autoMemory-header">
            <h3 style="margin: 0; color: #fff">ความทรงจำอัตโนมัติ</h3>
            <span id="autoMemoryToggle" style="cursor: pointer">✕</span>
        </div>
        <div class="autoMemory-content" id="autoMemoryContent">
            <p style="color: #aaa; text-align: center;">ยังไม่มีความทรงจำ</p>
        </div>
        <div class="autoMemory-actions">
            <button class="autoMemory-btn refresh" id="autoMemoryRefresh">รีเฟรช</button>
            <button class="autoMemory-btn clear" id="autoMemoryClear">ล้างทั้งหมด</button>
        </div>
    `;
    document.body.appendChild(panel);
    
    // เหตุการณ์สำหรับปุ่ม
    floatingBtn.addEventListener('click', () => {
        panel.classList.toggle('visible');
    });
    
    document.getElementById('autoMemoryToggle').addEventListener('click', () => {
        panel.classList.remove('visible');
    });
    
    document.getElementById('autoMemoryRefresh').addEventListener('click', refreshMemoryPanel);
    document.getElementById('autoMemoryClear').addEventListener('click', clearAllMemories);
    
    // โหลด memory เริ่มต้น
    refreshMemoryPanel();
}

// รีเฟรช panel แสดง memory
function refreshMemoryPanel() {
    const contentDiv = document.getElementById('autoMemoryContent');
    
    if (memoryEntries.length === 0) {
        contentDiv.innerHTML = '<p style="color: #aaa; text-align: center;">ยังไม่มีความทรงจำ</p>';
        return;
    }
    
    let html = '';
    memoryEntries.forEach((memory, index) => {
        html += `
            <div class="autoMemory-entry">
                <div style="font-weight: bold; color: #ffd700">#${index + 1}</div>
                <div>${memory.content}</div>
                <div class="autoMemory-keywords">
                    Keywords: ${memory.keywords.join(', ')}
                </div>
                <div style="font-size: 0.7em; color: #888; margin-top: 3px">
                    บันทึกเมื่อ: ${new Date(memory.timestamp).toLocaleString('th-TH')}
                </div>
            </div>
        `;
    });
    
    contentDiv.innerHTML = html;
}

// ล้าง memory ทั้งหมด
async function clearAllMemories() {
    if (!confirm('คุณแน่ใจหรือไม่ว่าต้องการล้างความทรงจำทั้งหมด?')) return;
    
    // ล้าง memory ในตัวแปร
    memoryEntries = [];
    
    // ล้าง memory ใน World Info
    try {
        await deleteWorldInfoEntriesByFolder(MEMORY_WORLD_INFO_NAME);
        console.log("ล้าง Memory ทั้งหมดแล้ว");
        showToast("ล้างความทรงจำทั้งหมดแล้ว");
        refreshMemoryPanel();
    } catch (error) {
        console.error("ไม่สามารถล้าง Memory ใน World Info ได้:", error);
    }
}

// แสดง toast notification
function showToast(message) {
    // สร้าง container สำหรับ toast ถ้ายังไม่มี
    let toastContainer = document.getElementById('autoMemoryToastContainer');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'autoMemoryToastContainer';
        toastContainer.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 99999;
            display: flex;
            flex-direction: column;
            gap: 10px;
            max-width: 300px;
        `;
        document.body.appendChild(toastContainer);
    }
    
    // สร้าง toast
    const toast = document.createElement('div');
    toast.style.cssText = `
        background: rgba(45, 45, 60, 0.95);
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 15px rgba(0,0,0,0.3);
        animation: slideIn 0.3s, fadeOut 0.5s 2.5s forwards;
        border-left: 4px solid #6a11cb;
    `;
    toast.innerHTML = message;
    
    // เพิ่ม animation keyframes
    injectStyles(`
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        
        @keyframes fadeOut {
            from { opacity: 1; }
            to { opacity: 0; transform: translateX(100%); }
        }
    `);
    
    toastContainer.appendChild(toast);
    
    // ลบ toast หลังจาก animation
    setTimeout(() => {
        toast.remove();
        // ลบ container ถ้าไม่มี toast เหลืออยู่
        if (toastContainer.children.length === 0) {
            toastContainer.remove();
        }
    }, 3000);
}

// helper functions
function injectStyles(css) {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
}

function getChatHistory() {
    // ฟังก์ชันนี้ควรดึงประวัติการแชทจาก SillyTavern
    // ในที่นี้เป็นตัวอย่างเท่านั้น
    return [
        {name: 'คุณ', mes: 'ฉันกินขนมปังอร่อยมากเลย ขนมปังรสสังขยาก็รสที่ฉันชอบมากเลยล่ะ'},
        {name: 'ตัวละคร', mes: 'จริงเหรอคะ? ฉันก็ชอบขนมปังสังขยาเหมือนกัน!'},
        {name: 'คุณ', mes: 'ใช่แล้ว ฉันชอบกินตอนเช้าพร้อมกาแฟร้อนๆ'},
        {name: 'ตัวละคร', mes: 'ฟังดูน่าอร่อยมากเลยค่ะ'}
    ];
}

async function generateText(prompt) {
    // ฟังก์ชันนี้ควรใช้ API ของ SillyTavern เพื่อสร้างข้อความ
    // ในที่นี้เป็นตัวอย่างเท่านั้น
    console.log("กำลังสร้างข้อความด้วย prompt:", prompt);
    return "เธอชอบกินขนมปังรสสังขยา";
}

async function loadWorldInfo() {
    // ฟังก์ชันนี้ควรโหลด World Info จาก SillyTavern
    return { entries: [] };
}

async function createWorldInfoEntry(entry) {
    // ฟังก์ชันนี้ควรสร้าง World Info entry ใน SillyTavern
    console.log("สร้าง World Info entry:", entry);
}

async function deleteWorldInfoEntriesByFolder(folderName) {
    // ฟังก์ชันนี้ควรลบ World Info entries โดย folder
    console.log("ลบ World Info entries ใน folder:", folderName);
}

function insertRelevantMemoriesIntoContext(memories) {
    // ฟังก์ชันนี้ควรแทรก memories ที่เกี่ยวข้องเข้าไปใน context
    console.log("แทรก Memories ที่เกี่ยวข้องเข้าไปใน context:", memories);
}

async function loadExtensionSettings(extensionName) {
    // ฟังก์ชันนี้ควรโหลดการตั้งค่า extension
    return {};
}

// เริ่มการทำงานเมื่อเอกสารโหลดเสร็จ
document.addEventListener('DOMContentLoaded', extensionAutoMemory);
