class MessageManager {
    constructor() {
        this.messageQueue = [];
        this.isSending = false;
        this.isPaused = false;
        this.settings = {
            wordsPerMinute: 60,
            delayBetweenMessages: 2
        };
        this.initializeUI();
        this.loadSettings();
        this.checkWhatsAppStatus();
    }

    async loadSettings() {
        try {
            const data = await chrome.storage.sync.get('messageSettings');
            if (data.messageSettings) {
                this.settings = data.messageSettings;
                // Actualizar UI con los valores guardados
                this.wordsPerMinuteInput.value = this.settings.wordsPerMinute;
                this.delayBetweenMessagesInput.value = this.settings.delayBetweenMessages;
            }
        } catch (error) {
            console.error('Error al cargar configuración:', error);
        }
    }

    async saveSettings() {
        try {
            await chrome.storage.sync.set({ messageSettings: this.settings });
        } catch (error) {
            console.error('Error al guardar configuración:', error);
        }
    }

    initializeUI() {
        // Configuración
        this.wordsPerMinuteInput = document.getElementById('wordsPerMinute');
        this.delayBetweenMessagesInput = document.getElementById('delayBetweenMessages');
        this.phoneNumberInput = document.getElementById('phoneNumber');
        this.messageTextInput = document.getElementById('messageText');
        this.messageQueueDiv = document.getElementById('messageQueue');
        this.statusPanel = document.getElementById('statusPanel');

        // Botones
        document.getElementById('addMessage').addEventListener('click', () => this.addMessage());
        document.getElementById('startSending').addEventListener('click', () => this.startSending());
        document.getElementById('pauseSending').addEventListener('click', () => this.togglePause());
        document.getElementById('clearQueue').addEventListener('click', () => this.clearQueue());

        // Eventos de configuración
        this.wordsPerMinuteInput.addEventListener('change', (e) => {
            this.settings.wordsPerMinute = parseInt(e.target.value);
            this.saveSettings();
        });
        this.delayBetweenMessagesInput.addEventListener('change', (e) => {
            this.settings.delayBetweenMessages = parseInt(e.target.value);
            this.saveSettings();
        });
    }

    async checkWhatsAppStatus() {
        try {
            const response = await chrome.runtime.sendMessage({ action: 'checkWhatsAppStatus' });
            this.updateStatus(response.status);
        } catch (error) {
            this.updateStatus('error');
        }
    }

    updateStatus(status) {
        this.statusPanel.className = 'status-panel';
        switch (status) {
            case 'connected':
                this.statusPanel.classList.add('connected');
                this.statusPanel.textContent = 'Estado: Conectado a WhatsApp Web';
                break;
            case 'disconnected':
                this.statusPanel.classList.add('disconnected');
                this.statusPanel.textContent = 'Estado: WhatsApp Web no está abierto';
                break;
            case 'qr':
                this.statusPanel.classList.add('warning');
                this.statusPanel.textContent = 'Estado: Se requiere escanear código QR';
                break;
            default:
                this.statusPanel.classList.add('error');
                this.statusPanel.textContent = 'Estado: Error de conexión';
        }
    }

    addMessage() {
        const phoneNumber = this.phoneNumberInput.value.trim();
        const messageText = this.messageTextInput.value.trim();

        if (!phoneNumber || !messageText) {
            this.showAlert('Por favor, complete todos los campos', 'error');
            return;
        }

        const message = {
            id: Date.now(),
            phoneNumber,
            message: messageText,
            status: 'pending',
            timestamp: new Date()
        };

        this.messageQueue.push(message);
        this.updateMessageQueue();
        this.clearInputs();
    }

    updateMessageQueue() {
        this.messageQueueDiv.innerHTML = '';
        this.messageQueue.forEach(msg => {
            const messageElement = document.createElement('div');
            messageElement.className = `message-item ${msg.status}`;
            messageElement.innerHTML = `
                <strong>${msg.phoneNumber}</strong>
                <p>${msg.message}</p>
                <small>Estado: ${this.getStatusText(msg.status)}</small>
            `;
            this.messageQueueDiv.appendChild(messageElement);
        });
    }

    getStatusText(status) {
        const statusMap = {
            'pending': 'Pendiente',
            'sending': 'Enviando',
            'success': 'Enviado',
            'failed': 'Fallido'
        };
        return statusMap[status] || status;
    }

    clearInputs() {
        this.phoneNumberInput.value = '';
        this.messageTextInput.value = '';
    }

    async startSending() {
        if (this.isSending) return;
        this.isSending = true;
        this.isPaused = false;

        while (this.messageQueue.length > 0 && !this.isPaused) {
            const message = this.messageQueue[0];
            message.status = 'sending';
            this.updateMessageQueue();

            try {
                // Calcular el tiempo de escritura basado en las palabras por minuto
                const typingDelay = this.calculateTypingDelay(message.message);
                console.log(`Tiempo de escritura calculado: ${typingDelay}ms para ${message.message.split(' ').length} palabras`);
                
                await this.sendMessage(message);
                message.status = 'success';
                
                // Esperar el tiempo configurado entre mensajes
                if (!this.isPaused && this.messageQueue.length > 1) {
                    const delayMs = this.settings.delayBetweenMessages * 1000;
                    console.log(`Esperando ${delayMs}ms antes del siguiente mensaje...`);
                    await this.delay(delayMs);
                }
            } catch (error) {
                message.status = 'failed';
                this.showAlert(`Error al enviar mensaje a ${message.phoneNumber}: ${error.message}`, 'error');
                
                // En caso de error, esperar un poco más antes de continuar
                if (!this.isPaused) {
                    await this.delay(5000);
                }
            }

            this.updateMessageQueue();
            this.messageQueue.shift();
        }

        this.isSending = false;
    }

    calculateTypingDelay(message) {
        const words = message.split(' ').length;
        const wordsPerMinute = this.settings.wordsPerMinute;
        const minutes = words / wordsPerMinute;
        const delayMs = minutes * 60 * 1000; // Convertir a milisegundos
        
        // Asegurar un tiempo mínimo de escritura
        const minDelay = 1000; // 1 segundo mínimo
        const maxDelay = 30000; // 30 segundos máximo
        
        return Math.min(Math.max(delayMs, minDelay), maxDelay);
    }

    async sendMessage(message) {
        const typingDelay = this.calculateTypingDelay(message.message);
        
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
                action: 'performWhatsAppAction',
                data: {
                    type: 'sendMessage',
                    recipient: message.phoneNumber,
                    message: message.message,
                    typingDelay: typingDelay
                }
            }, response => {
                if (response && response.success) {
                    resolve();
                } else {
                    reject(new Error(response?.error || 'Error desconocido'));
                }
            });
        });
    }

    togglePause() {
        this.isPaused = !this.isPaused;
        if (!this.isPaused) {
            this.startSending();
        }
    }

    clearQueue() {
        this.messageQueue = [];
        this.updateMessageQueue();
    }

    showAlert(message, type) {
        const alert = document.createElement('div');
        alert.className = `alert ${type}`;
        alert.textContent = message;
        document.querySelector('.container').insertBefore(alert, document.querySelector('.message-controls'));
        setTimeout(() => alert.remove(), 5000);
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Inicializar el gestor de mensajes
const messageManager = new MessageManager(); 