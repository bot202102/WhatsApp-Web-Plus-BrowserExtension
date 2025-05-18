// Mantener un registro de las acciones pendientes
let pendingActions = {};

// Cola de mensajes y control de estado
const messageQueue = [];
let isProcessingQueue = false;
let queueTimer = null;

// Función para generar un ID único para las acciones
function generateActionId() {
    return 'action_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
}

// Función para enviar un mensaje a través de WhatsApp
async function sendWhatsAppMessage(recipient, message, typingDelay = 0) {
    try {
        console.log(`Iniciando envío de mensaje a ${recipient}: "${message}"`);
        
        // Normalizar el número telefónico (eliminar espacios, guiones, etc.)
        let phoneNumber = recipient.replace(/[\s\-\(\)\+]/g, '');
        
        // Si el número no empieza con +, agregar el signo +
        if (!phoneNumber.startsWith('+') && !phoneNumber.startsWith('0')) {
            phoneNumber = '+' + phoneNumber;
        }
        
        // Codificar el mensaje para URL
        const encodedMessage = encodeURIComponent(message);
        
        // Construir la URL de WhatsApp Web
        const whatsappUrl = `https://web.whatsapp.com/send?phone=${phoneNumber.replace('+', '')}&text=${encodedMessage}`;
        console.log(`URL de WhatsApp Web: ${whatsappUrl}`);
        
        // Abrir o actualizar la pestaña de WhatsApp Web
        let targetTab;
        const existingTabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
        
        if (existingTabs.length > 0) {
            console.log('Actualizando pestaña existente de WhatsApp Web');
            targetTab = existingTabs[0];
            await chrome.tabs.update(targetTab.id, { url: whatsappUrl, active: true });
        } else {
            console.log('Abriendo nueva pestaña de WhatsApp Web');
            targetTab = await chrome.tabs.create({ url: whatsappUrl, active: true });
        }
        
        // Esperar a que la página se cargue
        console.log('Esperando a que la página se cargue...');
        await new Promise((resolve) => {
            const tabId = targetTab.id;
            
            const onUpdated = (changedTabId, changeInfo) => {
                if (changedTabId === tabId && changeInfo.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(onUpdated);
                    console.log('Página cargada completamente');
                    
                    // Dar un tiempo extra para asegurar que WhatsApp Web esté inicializado
                    setTimeout(resolve, 3000);
                }
            };
            
            chrome.tabs.onUpdated.addListener(onUpdated);
            
            // Timeout para evitar esperas infinitas
            setTimeout(() => {
                chrome.tabs.onUpdated.removeListener(onUpdated);
                console.log('Timeout esperando carga de página, continuando...');
                resolve();
            }, 30000);
        });
        
        // Intentar ejecutar el script para enviar el mensaje
        console.log('Inyectando script para enviar mensaje...');
        const results = await chrome.scripting.executeScript({
            target: { tabId: targetTab.id },
            function: async (message, typingDelay) => {
                try {
                    // Esperar a que WhatsApp esté realmente listo
                    await new Promise(resolve => {
                        const checkReady = () => {
                            // Verificar si se muestra el QR code
                            const qrCode = document.querySelector('div[data-ref]') || 
                                           document.querySelector('canvas[aria-label="Scan me!"]');
                            if (qrCode) {
                                console.log('Esperando escaneo de QR code...');
                                setTimeout(checkReady, 1000);
                                return;
                            }
                            
                            // Verificar si hay un mensaje de error
                            const errorMessage = document.querySelector('div[data-animate-modal-body="true"]');
                            if (errorMessage) {
                                const errorText = errorMessage.textContent || '';
                                if (errorText.includes("invalidado") || errorText.includes("invalid") || 
                                    errorText.includes("no existe")) {
                                    throw new Error(`El número no es válido o no existe en WhatsApp: ${errorText}`);
                                }
                            }
                            
                            // Buscar el campo de mensaje
                            const inputSelectors = [
                                'div[contenteditable="true"][data-lexical-editor="true"]',
                                'div[contenteditable="true"][aria-label="Mensaje"]',
                                'div[contenteditable="true"][aria-label="Message"]',
                                '#main footer div[role="textbox"]',
                                'div[data-testid="conversation-compose-box-input"]'
                            ];
                            
                            let inputField = null;
                            for (const selector of inputSelectors) {
                                inputField = document.querySelector(selector);
                                if (inputField) break;
                            }
                            
                            if (inputField) {
                                console.log('Campo de mensaje encontrado');
                                resolve();
                            } else {
                                console.log('Esperando campo de mensaje...');
                                setTimeout(checkReady, 1000);
                            }
                        };
                        
                        checkReady();
                    });
                    
                    // Buscar el campo de mensaje
                    const inputSelectors = [
                        'div[contenteditable="true"][data-lexical-editor="true"]',
                        'div[contenteditable="true"][aria-label="Mensaje"]',
                        'div[contenteditable="true"][aria-label="Message"]',
                        '#main footer div[role="textbox"]',
                        'div[data-testid="conversation-compose-box-input"]'
                    ];
                    
                    let inputField = null;
                    for (const selector of inputSelectors) {
                        inputField = document.querySelector(selector);
                        if (inputField) break;
                    }
                    
                    if (!inputField) {
                        throw new Error('No se encontró el campo de mensaje');
                    }
                    
                    // Verificar si el mensaje ya está escrito
                    const currentText = inputField.textContent || '';
                    if (currentText.trim() !== message.trim()) {
                        // El mensaje no está escrito correctamente, escribirlo
                        inputField.focus();
                        inputField.textContent = '';
                        inputField.dispatchEvent(new Event('input', { bubbles: true }));
                        
                        // Simular escritura con delay
                        if (typingDelay > 0) {
                            const words = message.split(' ');
                            const delay = Math.max(typingDelay / words.length, 50);
                            
                            for (const word of words) {
                                inputField.textContent += word + ' ';
                                inputField.dispatchEvent(new Event('input', { bubbles: true }));
                                await new Promise(resolve => setTimeout(resolve, delay));
                            }
                        } else {
                            inputField.textContent = message;
                            inputField.dispatchEvent(new Event('input', { bubbles: true }));
                        }
                    }
                    
                    // Buscar el botón de envío
                    const sendButtonSelectors = [
                        'button[data-testid="compose-btn-send"]',
                        'span[data-icon="send"]',
                        'button[aria-label="Enviar"]',
                        'button[aria-label="Send"]',
                        'span[data-icon="wds-ic-send-filled"]'
                    ];
                    
                    let sendButton = null;
                    for (const selector of sendButtonSelectors) {
                        const element = document.querySelector(selector);
                        if (element) {
                            if (element.tagName === 'SPAN') {
                                sendButton = element.closest('button');
                            } else {
                                sendButton = element;
                            }
                            if (sendButton) break;
                        }
                    }
                    
                    if (!sendButton) {
                        throw new Error('No se encontró el botón de envío');
                    }
                    
                    // Hacer clic en el botón de envío
                    sendButton.click();
                    
                    // Esperar un momento para asegurar que el mensaje se envía
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                    return { success: true, message: 'Mensaje enviado correctamente' };
                } catch (error) {
                    return { success: false, error: error.message || 'Error desconocido al enviar mensaje' };
                }
            },
            args: [message, typingDelay]
        });
        
        // Verificar el resultado
        if (results && results[0] && results[0].result) {
            const result = results[0].result;
            if (result.success) {
                console.log('Mensaje enviado correctamente');
                return { success: true, message: result.message };
            } else {
                console.error('Error al enviar mensaje:', result.error);
                return { success: false, error: result.error };
            }
        }
        
        throw new Error('No se pudo ejecutar el script para enviar el mensaje');
    } catch (error) {
        console.error('Error en sendWhatsAppMessage:', error);
        return { success: false, error: error.message || 'Error desconocido' };
    }
}

// Función para agregar un mensaje a la cola
function addMessageToQueue(recipient, message, typingDelay = 0, callback) {
    const messageId = generateActionId();
    
    // Crear objeto de mensaje
    const messageObj = {
        id: messageId,
        recipient,
        message,
        typingDelay,
        callback,
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
        addedAt: Date.now()
    };
    
    // Agregar el mensaje a la cola
    messageQueue.push(messageObj);
    console.log(`Mensaje añadido a la cola. ID: ${messageId}. Total en cola: ${messageQueue.length}`);
    
    // Iniciar procesamiento de la cola si no está activo
    if (!isProcessingQueue) {
        processQueue();
    }
    
    return messageId;
}

// Función para procesar la cola de mensajes
async function processQueue() {
    if (isProcessingQueue || messageQueue.length === 0) {
        return;
    }
    
    isProcessingQueue = true;
    console.log(`Procesando cola de mensajes. Mensajes pendientes: ${messageQueue.length}`);
    
    try {
        // Obtener el próximo mensaje
        const nextMessage = messageQueue[0];
        nextMessage.status = 'processing';
        nextMessage.attempts++;
        
        console.log(`Procesando mensaje ID: ${nextMessage.id}, Intento: ${nextMessage.attempts}/${nextMessage.maxAttempts}`);
        
        // Enviar el mensaje
        const result = await sendWhatsAppMessage(
            nextMessage.recipient, 
            nextMessage.message, 
            nextMessage.typingDelay
        );
        
        // Procesar el resultado
        if (result.success) {
            nextMessage.status = 'sent';
            console.log(`Mensaje ID: ${nextMessage.id} enviado correctamente`);
            
            // Eliminar el mensaje de la cola
            messageQueue.shift();
            
            // Notificar al callback si existe
            if (typeof nextMessage.callback === 'function') {
                nextMessage.callback(result);
            }
        } else {
            // Manejar el error
            console.error(`Error al enviar mensaje ID: ${nextMessage.id}:`, result.error);
            
            if (nextMessage.attempts >= nextMessage.maxAttempts) {
                // Si se alcanzó el número máximo de intentos, marcar como fallido
                nextMessage.status = 'failed';
                console.error(`Mensaje ID: ${nextMessage.id} falló después de ${nextMessage.attempts} intentos`);
                
                // Notificar al callback si existe
                if (typeof nextMessage.callback === 'function') {
                    nextMessage.callback({
                        success: false,
                        error: `Falló después de ${nextMessage.attempts} intentos. Último error: ${result.error}`
                    });
                }
                
                // Eliminar el mensaje de la cola
                messageQueue.shift();
            } else {
                // Si aún hay intentos disponibles, dejar el mensaje en la cola para reintento
                nextMessage.status = 'pending';
                console.log(`Reintentando mensaje ID: ${nextMessage.id} más tarde...`);
                
                // Mover el mensaje al final de la cola para intentar los demás primero
                const failedMessage = messageQueue.shift();
                messageQueue.push(failedMessage);
            }
        }
    } catch (error) {
        console.error('Error al procesar cola de mensajes:', error);
        
        // En caso de error, marcar el mensaje actual como pendiente para reintento
        if (messageQueue.length > 0) {
            const currentMessage = messageQueue[0];
            currentMessage.status = 'pending';
            
            if (currentMessage.attempts >= currentMessage.maxAttempts) {
                // Si ya se intentó el máximo de veces, marcar como fallido
                currentMessage.status = 'failed';
                
                // Notificar al callback si existe
                if (typeof currentMessage.callback === 'function') {
                    currentMessage.callback({
                        success: false,
                        error: `Falló después de ${currentMessage.attempts} intentos. Error del sistema: ${error.message}`
                    });
                }
                
                // Eliminar el mensaje de la cola
                messageQueue.shift();
            } else {
                // Mover el mensaje al final de la cola para intentar los demás primero
                const failedMessage = messageQueue.shift();
                messageQueue.push(failedMessage);
            }
        }
    } finally {
        isProcessingQueue = false;
        
        // Programar el siguiente procesamiento
        if (messageQueue.length > 0) {
            // Esperar un tiempo antes de procesar el siguiente mensaje
            queueTimer = setTimeout(processQueue, 3000);
        } else {
            console.log('Cola de mensajes vacía');
        }
    }
}

// Función para obtener el estado de la cola
function getQueueStatus() {
    return {
        totalMessages: messageQueue.length,
        pending: messageQueue.filter(m => m.status === 'pending').length,
        processing: messageQueue.filter(m => m.status === 'processing').length,
        failed: messageQueue.filter(m => m.status === 'failed').length,
        isProcessing: isProcessingQueue,
        messages: messageQueue.map(m => ({
            id: m.id,
            recipient: m.recipient,
            message: m.message.substring(0, 20) + (m.message.length > 20 ? '...' : ''),
            status: m.status,
            attempts: m.attempts,
            addedAt: new Date(m.addedAt).toLocaleString()
        }))
    };
}

// Modificar la parte del listener para usar la cola
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Mensaje recibido:', request);
    
    if (request.action === "checkWhatsAppStatus") {
        checkWhatsAppStatus()
            .then(status => {
                console.log('Estado enviado:', status);
                sendResponse(status);
            })
            .catch(error => {
                console.error('Error al verificar estado:', error);
                sendResponse({ status: 'error', error: error.message });
            });
        return true;
    }

    if (request.action === "performWhatsAppAction") {
        const data = request.data;
        
        if (data.type === "sendMessage") {
            // Agregar el mensaje a la cola
            const messageId = addMessageToQueue(
                data.recipient, 
                data.message, 
                data.typingDelay,
                (result) => {
                    // Este callback se llamará cuando el mensaje se procese
                    console.log(`Callback para mensaje ID: ${messageId}`, result);
                    sendResponse(result);
                }
            );
            
            // Responder inmediatamente que el mensaje se ha encolado
            sendResponse({
                success: true,
                status: 'queued',
                messageId,
                message: `Mensaje encolado. ID: ${messageId}`
            });
            
            return false;  // No esperamos respuesta asíncrona
        } else if (data.type === "getQueueStatus") {
            // Devolver el estado actual de la cola
            sendResponse(getQueueStatus());
            return false;
        } else if (data.type === "clearQueue") {
            // Limpiar la cola de mensajes
            const pendingCount = messageQueue.length;
            messageQueue.length = 0;
            if (queueTimer) {
                clearTimeout(queueTimer);
                queueTimer = null;
            }
            isProcessingQueue = false;
            
            sendResponse({
                success: true,
                message: `Cola de mensajes limpiada. ${pendingCount} mensajes eliminados.`
            });
            return false;
        }
        
        return false;
    }
    
    if (request.action === "navigateTo") {
        navigateToWhatsAppUrl(request.url)
            .then(result => {
                console.log('Navegación completada:', result);
                sendResponse(result);
            })
            .catch(error => {
                console.error('Error en navegación:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true;
    }
    
    if (request.action === "getCurrentTab") {
        getCurrentTab()
            .then(tab => {
                sendResponse(tab);
            })
            .catch(error => {
                console.error('Error al obtener pestaña:', error);
                sendResponse(null);
            });
        return true;
    }
    
    if (request.action === "contentScriptReady") {
        console.log('Content script listo en pestaña:', sender.tab?.id);
        return false;
    }
});

// Escuchar cambios en las pestañas
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url?.startsWith('https://web.whatsapp.com/')) {
        console.log('WhatsApp Web actualizado:', tabId, tab.url);
        // Verificar el estado cuando WhatsApp Web se carga completamente
        checkWhatsAppStatus();
    }
});

// Función para verificar el estado de WhatsApp
async function checkWhatsAppStatus() {
    try {
        console.log('Verificando estado de WhatsApp...');
        
        // Obtener todas las pestañas de WhatsApp Web
        const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
        console.log('Pestañas encontradas:', tabs.length);
        
        if (tabs.length === 0) {
            console.log('No se encontraron pestañas de WhatsApp Web');
            return { status: 'not_open' };
        }

        const activeTab = tabs[0];
        console.log('Pestaña activa:', activeTab.id, activeTab.url);
        
        // Verificar si la pestaña está cargada
        if (activeTab.status !== 'complete') {
            console.log('La pestaña aún no está completamente cargada');
            return { status: 'loading' };
        }

        // Intentar determinar el estado mediante script injection
        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId: activeTab.id },
                function: () => {
                    // Comprobar si estamos en la pantalla de QR
                    const qrCode = document.querySelector('div[data-ref]') || 
                                  document.querySelector('canvas[aria-label="Scan me!"]');
                    if (qrCode) {
                        return { status: 'qr' };
                    }
                    
                    // Comprobar si la aplicación principal está cargada
                    const mainApp = document.querySelector('#app');
                    const sidePanel = document.querySelector('#side') || 
                                     document.querySelector('[data-testid="chat-list"]');
                    
                    if (mainApp && sidePanel) {
                        return { status: 'connected' };
                    }
                    
                    return { status: 'disconnected' };
                }
            });
            
            if (results && results[0] && results[0].result) {
                return results[0].result;
            }
            
            return { status: 'unknown' };
        } catch (error) {
            console.warn('Error al ejecutar script de estado:', error);
            return { status: 'error', error: error.message };
        }
    } catch (error) {
        console.error('Error checking WhatsApp status:', error);
        return { status: 'error', error: error.message };
    }
}

// Función para abrir WhatsApp Web
async function openWhatsApp() {
    console.log('Intentando abrir WhatsApp Web...');
    const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
    
    if (tabs.length > 0) {
        console.log('WhatsApp Web ya está abierto, activando pestaña...');
        await chrome.tabs.update(tabs[0].id, { active: true });
    } else {
        console.log('Abriendo nueva pestaña de WhatsApp Web...');
        await chrome.tabs.create({ url: 'https://web.whatsapp.com' });
    }
}

// Función para navegar a una URL específica de WhatsApp Web
async function navigateToWhatsAppUrl(url) {
    try {
        console.log(`Navegando a: ${url}`);
        
        // Verificar si WhatsApp Web ya está abierto
        const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
        
        if (tabs.length > 0) {
            // Actualizar la URL de la pestaña existente
            console.log('Actualizando URL en pestaña existente');
            await chrome.tabs.update(tabs[0].id, { 
                url: url,
                active: true 
            });
            
            // Esperar a que la pestaña termine de cargar
            console.log('Esperando a que la pestaña termine de cargar...');
            return new Promise((resolve) => {
                const tabId = tabs[0].id;
                
                // Listener para detectar cuando la pestaña termina de cargar
                const onUpdated = (changedTabId, changeInfo) => {
                    if (changedTabId === tabId && changeInfo.status === 'complete') {
                        chrome.tabs.onUpdated.removeListener(onUpdated);
                        console.log('Pestaña cargada completamente');
                        
                        // Dar tiempo adicional para que se inicialice la página
                        setTimeout(() => {
                            resolve({ success: true });
                        }, 2000);
                    }
                };
                
                chrome.tabs.onUpdated.addListener(onUpdated);
                
                // Timeout para evitar esperas infinitas
                setTimeout(() => {
                    chrome.tabs.onUpdated.removeListener(onUpdated);
                    console.log('Timeout esperando carga de pestaña, continuando...');
                    resolve({ success: true });
                }, 15000);
            });
        } else {
            // Abrir una nueva pestaña
            console.log('Abriendo nueva pestaña con URL');
            const newTab = await chrome.tabs.create({ url: url });
            
            // Esperar a que la nueva pestaña termine de cargar
            console.log('Esperando a que la nueva pestaña termine de cargar...');
            return new Promise((resolve) => {
                const tabId = newTab.id;
                
                // Listener para detectar cuando la pestaña termina de cargar
                const onUpdated = (changedTabId, changeInfo) => {
                    if (changedTabId === tabId && changeInfo.status === 'complete') {
                        chrome.tabs.onUpdated.removeListener(onUpdated);
                        console.log('Nueva pestaña cargada completamente');
                        
                        // Dar tiempo adicional para que se inicialice la página
                        setTimeout(() => {
                            resolve({ success: true });
                        }, 2000);
                    }
                };
                
                chrome.tabs.onUpdated.addListener(onUpdated);
                
                // Timeout para evitar esperas infinitas
                setTimeout(() => {
                    chrome.tabs.onUpdated.removeListener(onUpdated);
                    console.log('Timeout esperando carga de nueva pestaña, continuando...');
                    resolve({ success: true });
                }, 15000);
            });
        }
    } catch (error) {
        console.error('Error al navegar a URL:', error);
        return { success: false, error: error.message };
    }
}

// Función para obtener la pestaña actual
async function getCurrentTab() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        return tab;
    } catch (error) {
        console.error('Error al obtener pestaña actual:', error);
        return null;
    }
}

// Inicializar configuración
chrome.storage.sync.get('settings').then((data) => {
    if (data?.settings === undefined) {
        chrome.storage.sync.set({
            settings: {
                view_once_media: true,
                keep_revoked_messages: true,
                keep_edited_messages: true,
                indicate_sender_os: true,
                special_tags: true,
                blue_ticks: true,
                fullscreen: true
            }
        });
    }
});
