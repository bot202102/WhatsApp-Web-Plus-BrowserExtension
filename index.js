// Evitar la ejecución múltiple
if (window.whatsAppExtensionInitialized) {
    console.log('Extension ya inicializada. Evitando inicialización múltiple.');
} else {
    window.whatsAppExtensionInitialized = true;

    // Función para esperar a que WhatsApp Web esté completamente cargado
    const waitForWhatsAppLoad = () => {
        return new Promise((resolve) => {
            const checkLoaded = () => {
                if (document.querySelector('#app')) {
                    resolve();
                } else {
                    setTimeout(checkLoaded, 100);
                }
            };
            checkLoaded();
        });
    };

    // Función para esperar a que un elemento aparezca en el DOM
    async function waitForElement(selector, timeout = 10000) {
        return new Promise((resolve) => {
            // Verificar si el elemento ya existe
            const existingElement = document.querySelector(selector);
            if (existingElement) {
                resolve(existingElement);
                return;
            }
            
            const startTime = Date.now();
            const interval = setInterval(() => {
                const element = document.querySelector(selector);
                if (element) {
                    clearInterval(interval);
                    resolve(element);
                } else if (Date.now() - startTime > timeout) {
                    clearInterval(interval);
                    console.warn(`Elemento no encontrado con selector: ${selector} después de ${timeout}ms`);
                    resolve(null);
                }
            }, 100);
        });
    };

    // Función para esperar a que WhatsApp esté listo para enviar mensajes
    async function waitForWhatsAppReady() {
        return new Promise((resolve) => {
            const checkReady = () => {
                // Verificar si estamos en la pantalla de QR
                const qrCode = document.querySelector('div[data-ref]');
                if (qrCode) {
                    setTimeout(checkReady, 1000);
                    return;
                }

                // Verificar si la aplicación está cargada
                const mainApp = document.querySelector('#app');
                const chatList = document.querySelector('#side') || 
                                document.querySelector('[data-testid="chat-list"]');
                
                if (mainApp && chatList) {
                    resolve();
                } else {
                    setTimeout(checkReady, 1000);
                }
            };
            checkReady();
        });
    };

    // Función para encontrar el campo de mensaje
    async function findMessageBox() {
        const selectors = [
            'div[contenteditable="true"][data-lexical-editor="true"]',
            'div[contenteditable="true"][aria-label="Mensaje"]',
            'div[contenteditable="true"][aria-label="Message"]',
            '#main footer div[role="textbox"]',
            'div[data-testid="conversation-compose-box-input"]'
        ];

        for (const selector of selectors) {
            const el = await waitForElement(selector, 2000);
            if (el) {
                console.log(`Campo de mensaje encontrado con selector: ${selector}`);
                return el;
            }
        }
        return null;
    };

    // Función para encontrar el botón de envío
    async function findSendButton() {
        const selectors = [
            'button[data-testid="compose-btn-send"]',
            'span[data-icon="send"]',
            'button[aria-label="Enviar"]',
            'button[aria-label="Send"]',
            'span[data-icon="wds-ic-send-filled"]'
        ];

        for (const selector of selectors) {
            let el = await waitForElement(selector, 2000);
            if (el) {
                if (el.tagName === 'SPAN' && (el.getAttribute('data-icon') === 'send' || el.getAttribute('data-icon') === 'wds-ic-send-filled')) {
                    const parentButton = el.closest('button');
                    if (parentButton) {
                        console.log('Botón de envío encontrado (parent de span)');
                        return parentButton;
                    }
                }
                console.log(`Botón de envío encontrado con selector: ${selector}`);
                return el;
            }
        }
        return null;
    };

    // Función para abrir un chat usando URL directa
    async function openChat(contactNumber, message = '') {
        // Normalizar el número telefónico (eliminar espacios, guiones, etc.)
        let phoneNumber = contactNumber.replace(/[\s\-\(\)\+]/g, '');
        
        // Si el número no empieza con +, agregar el signo +
        if (!phoneNumber.startsWith('+') && !phoneNumber.startsWith('0')) {
            phoneNumber = '+' + phoneNumber;
        }
        
        console.log(`Abriendo chat con número normalizado: ${phoneNumber}`);
        
        // Construir la URL de WhatsApp Web
        let whatsappUrl = `https://web.whatsapp.com/send?phone=${phoneNumber.replace('+', '')}`;
        
        // Si hay mensaje, agregarlo a la URL
        if (message) {
            // Codificar el mensaje para URL
            const encodedMessage = encodeURIComponent(message);
            whatsappUrl += `&text=${encodedMessage}`;
            console.log('Mensaje pre-cargado en la URL');
        }
        
        console.log(`URL de WhatsApp Web: ${whatsappUrl}`);
        
        // Verificar si ya estamos en WhatsApp Web
        if (window.location.href.startsWith('https://web.whatsapp.com/')) {
            // Estamos en WhatsApp, navegar directamente
            console.log('Ya estamos en WhatsApp Web, navegando directamente');
            window.location.href = whatsappUrl;
            
            // Esperar a que se cargue la página
            await new Promise(resolve => {
                const checkInterval = setInterval(() => {
                    if (document.readyState === 'complete') {
                        clearInterval(checkInterval);
                        resolve();
                    }
                }, 500);
            });
        } else {
            // No estamos en WhatsApp, solicitar al background script que abra o actualice la URL
            console.log('Solicitando al background script que navegue a WhatsApp Web');
            const result = await chrome.runtime.sendMessage({
                action: "navigateTo",
                url: whatsappUrl
            });
            
            if (!result || !result.success) {
                console.error("Error al navegar a la URL de WhatsApp Web");
                return false;
            }
        }
        
        // Esperar a que se cargue la página y aparezca el campo de mensaje
        console.log("Esperando a que se cargue el chat...");
        
        // Esperar a que WhatsApp esté listo
        await waitForWhatsAppReady();
        
        // Verificar si hay un mensaje de error (número inexistente)
        const errorMessage = await waitForElement('div[data-animate-modal-body="true"]', 5000);
        if (errorMessage) {
            const errorText = errorMessage.textContent || '';
            if (errorText.includes("invalidado") || errorText.includes("invalid") || errorText.includes("no existe")) {
                console.error(`Error: El número ${phoneNumber} no es válido o no existe en WhatsApp`);
                return false;
            }
        }
        
        // Esperar a que aparezca el campo de mensaje
        const messageBox = await findMessageBox();
        if (!messageBox) {
            console.error("No se pudo encontrar el campo de mensaje después de abrir el chat");
            return false;
        }
        
        console.log("Chat abierto correctamente");
        return true;
    };

    // Función para escribir y enviar un mensaje
    async function typeAndSendMessage(message, typingDelay = 0) {
        // Esperar a que WhatsApp esté listo
        await waitForWhatsAppReady();
        console.log('Intentando enviar mensaje');

        const messageBox = await findMessageBox();
        if (!messageBox) {
            throw new Error("No se encontró el campo de mensaje");
        }

        console.log('Campo de mensaje encontrado, verificando contenido...');
        
        // Verificar si el mensaje ya está cargado (en caso de haber usado el parámetro text en la URL)
        const currentText = messageBox.textContent || '';
        if (currentText.trim() === message.trim()) {
            console.log('El mensaje ya está cargado correctamente, solo necesitamos enviarlo');
        } else {
            // El mensaje no está cargado correctamente, necesitamos escribirlo
            console.log('El mensaje no está precargado o es diferente, escribiéndolo...');
            messageBox.focus();

            // Limpiar el contenido actual
            messageBox.textContent = '';
            messageBox.dispatchEvent(new Event('input', { bubbles: true }));
            await new Promise(resolve => setTimeout(resolve, 300));

            if (typingDelay > 0) {
                console.log(`Escribiendo mensaje con retraso: ${typingDelay}ms`);
                const words = message.split(' ');
                const delay = Math.max(typingDelay / words.length, 50);
                
                // Escribir palabra por palabra con el delay calculado
                for (let i = 0; i < words.length; i++) {
                    const word = words[i];
                    messageBox.textContent += word + ' ';
                    messageBox.dispatchEvent(new Event('input', { bubbles: true }));
                    
                    // Esperar el tiempo calculado entre palabras
                    await new Promise(resolve => setTimeout(resolve, delay));
                    
                    // Agregar una pequeña variación aleatoria para simular escritura humana
                    const randomDelay = Math.random() * 100;
                    await new Promise(resolve => setTimeout(resolve, randomDelay));
                }
            } else {
                console.log('Escribiendo mensaje sin retraso');
                messageBox.textContent = message;
                messageBox.dispatchEvent(new Event('input', { bubbles: true }));
            }

            // Esperar un momento después de escribir antes de enviar
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        const sendButton = await findSendButton();
        if (!sendButton) {
            throw new Error("No se encontró el botón de envío");
        }

        console.log('Botón de envío encontrado, enviando mensaje...');
        sendButton.click();
        
        // Esperar a que el mensaje se envíe completamente
        await new Promise(resolve => setTimeout(resolve, 2000));
    };

    // Función para verificar el estado de WhatsApp
    function checkWhatsAppStatus() {
        console.log('Verificando estado de WhatsApp');
        
        // Comprobar si estamos en la pantalla de carga
        const initialLoader = document.querySelector('#initial_startup') || 
                            document.querySelector('.landing-wrapper');
        if (initialLoader) {
            console.log('Estado: Cargando, WhatsApp está iniciando');
            return { status: 'loading' };
        }
        
        // Comprobar si estamos en la pantalla de QR
        const qrCode = document.querySelector('div[data-ref]') || 
                      document.querySelector('canvas[aria-label="Scan me!"]') ||
                      document.querySelector('.landing-main canvas');
        if (qrCode) {
            console.log('Estado: QR Code, esperando escaneo');
            return { status: 'qr' };
        }

        // Comprobar si la aplicación principal está cargada
        const mainApp = document.querySelector('#app');
        const sidePanel = document.querySelector('#side') || 
                        document.querySelector('[data-testid="chat-list"]') ||
                        document.querySelector('div[data-testid="default-user"]');
        
        // Ver exactamente qué elementos se encuentran para depuración
        console.log('Elementos encontrados:', {
            mainApp: !!mainApp,
            sidePanel: !!sidePanel
        });
        
        // También intentar encontrar elementos específicos de la UI
        const searchBox = document.querySelector('div[contenteditable="true"][data-testid="chat-list-search"]') ||
                        document.querySelector('div[contenteditable="true"][title="Buscar o empezar un nuevo chat"]') ||
                        document.querySelector('div[contenteditable="true"][title="Search or start new chat"]');
        
        const profilePic = document.querySelector('div[data-testid="default-user"] img') || 
                          document.querySelector('[data-testid="menu-bar-avatar"]');
        
        console.log('Elementos adicionales encontrados:', {
            searchBox: !!searchBox,
            profilePic: !!profilePic
        });
        
        // Enumerar todos los selectores que podemos encontrar para diagnóstico
        const diagnosticSelectors = [
            { name: 'app', found: !!document.querySelector('#app') },
            { name: 'side', found: !!document.querySelector('#side') },
            { name: 'chat-list', found: !!document.querySelector('[data-testid="chat-list"]') },
            { name: 'default-user', found: !!document.querySelector('[data-testid="default-user"]') },
            { name: 'search-box', found: !!searchBox },
            { name: 'profile-pic', found: !!profilePic },
            { name: 'conversation-panel-wrapper', found: !!document.querySelector('#main') }
        ];
        
        console.log('Diagnóstico de selectores:', diagnosticSelectors);
        
        // Si encontramos suficientes elementos para confirmar que WhatsApp está cargado
        if (mainApp && (sidePanel || searchBox || profilePic)) {
            console.log('Estado: Conectado');
            return { status: 'connected' };
        }

        console.log('Estado: Desconectado');
        return { status: 'disconnected' };
    };

    // Escuchar mensajes del background script
    chrome.runtime.onMessage.addListener(
        function(request, sender, sendResponse) {
            console.log('Mensaje recibido en content script:', request);
            
            if (request.action === "getWhatsAppStatus") {
                const status = checkWhatsAppStatus();
                console.log('Enviando estado:', status);
                sendResponse(status);
                return true;
            }

            if (request.action === "performWhatsAppAction") {
                const data = request.data;
                console.log('Realizando acción:', data);

                if (data.type === "sendMessage") {
                    // Guardar la respuesta para poder enviarla de forma asíncrona
                    let responseFunction = sendResponse;
                    
                    (async () => {
                        try {
                            // Esperar a que WhatsApp esté listo
                            await waitForWhatsAppReady();
                            
                            // Abrir chat con el destinatario (y precargar el mensaje en la URL)
                            console.log('Abriendo chat con:', data.recipient);
                            const chatOpened = await openChat(data.recipient, data.message);
                            if (!chatOpened) {
                                console.error('No se pudo abrir el chat');
                                responseFunction({ success: false, error: "No se pudo abrir el chat" });
                                return;
                            }

                            // Esperar un momento para asegurar que todo está cargado
                            await new Promise(resolve => setTimeout(resolve, 1500));

                            // Verificar si encontramos el campo de mensaje
                            const messageBox = await findMessageBox();
                            if (!messageBox) {
                                console.error('No se encontró el campo de mensaje');
                                responseFunction({ success: false, error: "No se encontró el campo de mensaje" });
                                return;
                            }

                            // Enviar mensaje
                            console.log('Verificando y enviando mensaje:', data.message);
                            await typeAndSendMessage(data.message, data.typingDelay);
                            console.log('Mensaje enviado correctamente');
                            responseFunction({ success: true, message: "Mensaje enviado correctamente" });
                        } catch (error) {
                            console.error("Error al enviar mensaje:", error);
                            responseFunction({ success: false, error: error.message });
                        }
                    })();
                    
                    return true;
                }
            }
            
            return false;
        }
    );

    // Inicialización
    console.log('Content script inicializado, esperando mensajes');

    // Notificar que estamos listos
    chrome.runtime.sendMessage({ action: "contentScriptReady" });

    // Manejar actualizaciones de configuración
    function handle_settings_update(settings) {
        console.log('Configuración actualizada:', settings);
        window.postMessage({'settings': settings}, '*');
    };

    // Cargar configuración inicial
    setTimeout(function () {
        chrome.storage.sync.get('settings').then((data) => {
            console.log('Configuración inicial cargada:', data.settings);
            window.postMessage({'settings': data.settings}, '*');
        });
    }, 2000);
}
