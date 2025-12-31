// AutoMemory Extension
let autoMemorySettings = {};
let memoryEntries = [];
let messageCounter = 0;
const MEMORY_WORLD_INFO_NAME = "AutoMemory";

// เริ่มการทำงานของ Extension
async function extensionAutoMemory() {
    // โหลดการตั้งค่า
    autoMemorySettings = await getSettings();
    messageCounter = 0;
    
    // สร้าง UI
    createFloatingButton();
    
    // โหลด memory จาก world info
    await loadMemories();
    
    // ฟังเหตุการณ์การส่งข้อความ
    document.addEventListener('messageSent', handleNewMessage);
    document.addEventListener('messageReceived', handleNewMessage);
    
    console.log("AutoMemory Extension ทำงานแล้ว!");
}

// โหลดการตั้งค่า
async function getSettings() {
    const defaultSettings = {
        auto_memory_frequency: 5,
        memory_limit: 20,
        memory_importance_threshold: 0.7
    };
    
    try {
        const savedSettings = await loadExtensionSettings('AutoMemory');
        return {...defaultSettings, ...savedSettings};
    } catch (error) {
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
