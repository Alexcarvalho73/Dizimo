// Em produção (Render), usa o mesmo domínio da página. Local usa localhost:5000
const API_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:5000/api'
    : '/api';

const APP_VERSION = '2.17';

const app = {
    state: {
        user: null,
        currentView: '',
        token: null,
        version: APP_VERSION
    },

    async authFetch(url, options = {}) {
        const headers = options.headers || {};
        if (this.state.user) {
            headers['X-User-Id'] = this.state.user.id_usuario;
        }
        return fetch(url, { ...options, headers });
    },

    hasPermission(name) {
        if (!this.state.user) return false;
        // Perfil 1 = Admin sempre tem permissão
        if (parseInt(this.state.user.id_perfil) === 1) return true;
        if (!this.state.user.permissoes) return false;
        return this.state.user.permissoes.includes(name);
    },

    checkSessionRefresh() {
        if (!this.state.user || !this.state.user.ultimo_login) return;
        const last = new Date(this.state.user.ultimo_login);
        const now = new Date();
        if (last.toDateString() !== now.toDateString()) {
            this.refreshSession();
        }
    },

    async refreshSession() {
        try {
            const res = await this.authFetch(`${API_URL}/auth/heartbeat`, { method: 'POST' });
            if (res.ok) {
                const data = await res.json();
                this.state.user.ultimo_login = data.ultimo_login;
                localStorage.setItem('dizimo_user', JSON.stringify(this.state.user));
            }
        } catch (e) { }
    },

    async handleResponseError(res, defaultMsg) {
        let msg = defaultMsg || 'Ocorreu um erro inesperado';
        try {
            const data = await res.json();
            if (data.error) msg = data.error;
            else if (data.message) msg = data.message;
        } catch (e) {
            // Se não for JSON, não faz nada
        }
        this.showToast(msg, 'error');
    },

    async init() {
        this.container = document.getElementById('app-container');

        // Carregar configurações do sistema (Nome/Logo)
        await this.loadConfigs();

        // Restore session
        const savedUser = localStorage.getItem('dizimo_user');
        if (savedUser) {
            this.state.user = JSON.parse(savedUser);
            this.renderMain();
            if (this.state.user.trocar_senha == 1) {
                this.navTo('dashboard'); // Need a view to render topbar etc
                this.abrirModalSenha(true);
            } else {
                this.navTo('dashboard');
            }
        } else {
            this.renderLogin();
        }
    },

    async loadConfigs() {
        try {
            const res = await fetch(`${API_URL}/configuracoes`);
            if (res.ok) {
                this.state.configs = await res.json();
                this.applyConfigs();
            }
        } catch (e) {
            console.error("Erro ao carregar configurações", e);
        }
    },

    applyConfigs() {
        const configs = this.state.configs || { paroquia_nome: 'Imaculado Coração de Maria', paroquia_logo: 'Logo.jpg' };

        // Atualiza todos os nomes nas classes
        document.querySelectorAll('.paroquia-nome').forEach(el => {
            if (el.tagName === 'INPUT') el.value = configs.paroquia_nome;
            else el.textContent = configs.paroquia_nome;
        });

        // Atualiza todos os logos nas classes
        document.querySelectorAll('.paroquia-logo').forEach(el => {
            el.src = configs.paroquia_logo;
        });
    },

    // UI Renders
    renderLogin() {
        const tpl = document.getElementById('tpl-login').content.cloneNode(true);
        this.container.innerHTML = '';
        this.container.appendChild(tpl);

        document.getElementById('form-login').addEventListener('submit', async (e) => {
            e.preventDefault();
            const u = document.getElementById('login-user').value;
            const p = document.getElementById('login-pass').value;
            const err = document.getElementById('login-error');

            try {
                const res = await app.authFetch(`${API_URL}/auth/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ login: u, senha: p })
                });
                const data = await res.json();

                if (res.ok) {
                    this.state.user = data.user;
                    localStorage.setItem('dizimo_user', JSON.stringify(data.user));
                    this.renderMain();
                    if (data.user.trocar_senha == 1) {
                        this.navTo('dashboard');
                        this.abrirModalSenha(true);
                    } else {
                        this.navTo('dashboard');
                    }
                } else {
                    err.textContent = data.error || 'Erro no login.';
                }
            } catch (error) {
                err.textContent = 'Erro ao conectar com o servidor.';
            }
        });
    },

    renderMain() {
        const tpl = document.getElementById('tpl-main').content.cloneNode(true);
        this.container.innerHTML = '';
        this.container.appendChild(tpl);

        document.getElementById('header-user-name').textContent = this.state.user.nome;
        this.checkSessionRefresh();
        const versionEl = document.getElementById('app-version');
        if (versionEl) versionEl.textContent = this.state.version;

        // Mobile Sidebar Logic
        const layout = document.querySelector('.layout');
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        layout.appendChild(overlay);

        const menuBtn = document.getElementById('mobile-menu-btn');
        if (menuBtn) {
            menuBtn.addEventListener('click', () => {
                sidebar.classList.add('open');
                overlay.classList.add('active');
            });
        }

        const closeSidebar = () => {
            sidebar.classList.remove('open');
            overlay.classList.remove('active');
        };
        overlay.addEventListener('click', closeSidebar);

        const isAdmin = this.state.user && (this.state.user.id_perfil == 1 || String(this.state.user.id_perfil) === '1');
        const perms = this.state.user.permissoes || [];

        if (isAdmin) {
            // Admin vê tudo
            ['nav-configs', 'nav-dizimistas', 'nav-recebimentos', 'nav-missas', 'nav-pastorais', 'nav-usuarios', 'nav-perfis', 'nav-relatorios'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = 'flex';
            });
        } else {
            // Controle baseado em permissões
            if (perms.includes('Visualizar Dizimistas')) document.getElementById('nav-dizimistas').style.display = 'flex';
            if (perms.includes('Visualizar Lançamentos')) document.getElementById('nav-recebimentos').style.display = 'flex';
            if (perms.includes('Visualizar Missas')) {
                document.getElementById('nav-missas').style.display = 'flex';
            }
            if (perms.includes('[Relatórios] Escala de Servos')) {
                document.getElementById('nav-relatorios').style.display = 'flex';
            }
            if (perms.includes('Visualizar Pastorais')) document.getElementById('nav-pastorais').style.display = 'flex';
            if (perms.includes('Visualizar Usuários')) document.getElementById('nav-usuarios').style.display = 'flex';
            if (perms.includes('Gerenciar Perfis')) document.getElementById('nav-perfis').style.display = 'flex';
        }

        // Reaplicar configs pois o tpl-main acabou de ser injetado
        this.applyConfigs();

        // Setup nav links e dropdown items
        document.querySelectorAll('.nav-item, .dropdown-item').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.currentTarget.getAttribute('data-target');
                if (target === 'logout') {
                    this.logout();
                } else if (target) {
                    this.navTo(target);
                    // Close sidebar automatically on mobile
                    closeSidebar();
                }
            });
        });
        // Profile Dropdown logic
        const profileToggle = document.getElementById('user-profile-toggle');
        const profileDropdown = document.getElementById('profile-dropdown');
        if (profileToggle) {
            profileToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                profileDropdown.classList.toggle('active');
            });
        }
        document.addEventListener('click', () => {
            if (profileDropdown) profileDropdown.classList.remove('active');
        });

        // Setup botões de abrir troca de senha
        const btnChangePass = document.getElementById('btn-open-change-pass');
        if (btnChangePass) {
            btnChangePass.addEventListener('click', () => this.abrirModalSenha(false));
        }

        // Setup Form Troca de Senha - Usar onsubmit para evitar múltiplos listeners
        const changePassForm = document.getElementById('form-change-pass');
        if (changePassForm) {
            changePassForm.onsubmit = async (e) => {
                e.preventDefault();
                const senhaAtual = document.getElementById('pass-atual').value;
                const novaSenha = document.getElementById('pass-nova').value;
                const confirma = document.getElementById('pass-confirma').value;

                if (novaSenha !== confirma) {
                    this.showToast('As senhas não conferem', 'error');
                    return;
                }

                try {
                    const res = await app.authFetch(`${API_URL}/auth/change-password`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            id_usuario: this.state.user.id_usuario,
                            senha_atual: senhaAtual,
                            nova_senha: novaSenha
                        })
                    });

                    if (res.ok) {
                        this.showToast('Senha alterada com sucesso!');
                        const modal = document.getElementById('modal-senha');
                        if (modal) {
                            modal.style.display = 'none';
                            if (modal.dataset.obrigatorio === 'true') {
                                this.state.user.trocar_senha = 0;
                                localStorage.setItem('dizimo_user', JSON.stringify(this.state.user));
                            }
                        }
                        changePassForm.reset();
                    } else {
                        const err = await res.json();
                        this.showToast(err.error || 'Erro ao trocar senha', 'error');
                    }
                } catch (error) {
                    this.showToast('Erro de conexão', 'error');
                }
            };
        }
    },

    validarCPF(cpf) {
        if (!cpf) return true; // Permite vazio se não for obrigatório
        cpf = cpf.replace(/[^\d]+/g, '');
        if (cpf.length !== 11) return false;
        
        // Elimina CPFs invalidos conhecidos
        if (/^(\d)\1+$/.test(cpf)) return false;

        // Valida 1o digito
        let add = 0;
        for (let i = 0; i < 9; i++)
            add += parseInt(cpf.charAt(i)) * (10 - i);
        let rev = 11 - (add % 11);
        if (rev === 10 || rev === 11) rev = 0;
        if (rev !== parseInt(cpf.charAt(9))) return false;

        // Valida 2o digito
        add = 0;
        for (let i = 0; i < 10; i++)
            add += parseInt(cpf.charAt(i)) * (11 - i);
        rev = 11 - (add % 11);
        if (rev === 10 || rev === 11) rev = 0;
        if (rev !== parseInt(cpf.charAt(10))) return false;

        return true;
    },

    abrirModalSenha(obrigatorio = false) {
        const modal = document.getElementById('modal-senha');
        if (!modal) return;
        
        modal.dataset.obrigatorio = obrigatorio;
        const btnFechar = modal.querySelector('.modal-header .btn-icon');
        const btnCancelar = modal.querySelector('.form-actions .btn-secondary');
        const form = document.getElementById('form-change-pass');
        
        if (form) form.reset();
        
        if (obrigatorio) {
            if (btnFechar) btnFechar.style.display = 'none';
            if (btnCancelar) {
                btnCancelar.textContent = 'Sair (Logout)';
                btnCancelar.onclick = () => this.logout();
            }
            modal.style.display = 'flex';
            // Previne fechar no clique fora
            modal.onmousedown = (e) => { if(e.target === modal) e.stopPropagation(); };
        } else {
            if (btnFechar) btnFechar.style.display = 'flex';
            if (btnCancelar) {
                btnCancelar.textContent = 'Cancelar';
                btnCancelar.onclick = () => modal.style.display = 'none';
            }
            modal.style.display = 'flex';
            modal.onmousedown = null;
        }
    },

    logout() {
        this.state.user = null;
        localStorage.removeItem('dizimo_user');
        
        // Esconde todos os modais abertos
        document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');

        this.renderLogin();
    },

    // Navigation Subsystem
    navTo(viewId, params = null) {
        // Controle de Acesso no Frontend
        const perms = this.state.user?.permissoes || [];
        const isAdmin = this.state.user?.id_perfil == 1 || String(this.state.user?.id_perfil) === '1';

        if (viewId === 'usuarios' && !isAdmin && !perms.includes('Visualizar Usuários')) {
            this.showToast('Acesso Negado: Você não tem permissão para visualizar usuários.', 'error');
            this.navTo('dashboard');
            return;
        }
        if (viewId === 'perfis' && !isAdmin && !perms.includes('Gerenciar Perfis')) {
            this.showToast('Acesso Negado: Gerenciamento de perfis restrito.', 'error');
            this.navTo('dashboard');
            return;
        }
        if (viewId === 'configuracoes' && !isAdmin) {
            this.showToast('Acesso Negado: Configurações restritas ao administrador.', 'error');
            this.navTo('dashboard');
            return;
        }

        this.state.currentView = viewId;
        const contentArea = document.getElementById('content-area');
        const tpl = document.getElementById(`view-${viewId}`);

        if (!tpl) return;

        contentArea.innerHTML = '';
        contentArea.appendChild(tpl.content.cloneNode(true));

        // Update active state in sidebar
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.classList.remove('active');
            if (btn.getAttribute('data-target') === viewId) btn.classList.add('active');
        });

        // Initialize view logic
        this.initView(viewId, params);
    },

    initView(viewId, params = null) {
        /* Set Title */
        const titles = {
            'dashboard': 'Dashboard Principal',
            'dizimistas': 'Gestão de Dizimistas',
            'novo-dizimista': 'Cadastro',
            'recebimentos': 'Lançamentos de Dízimos',
            'lancar-recebimento': 'Registrar Recebimento',
            'missas': 'Gestão de Missas',
            'missa-form': 'Cadastro de Missa',
            'usuarios': 'Gestão de Usuários',
            'usuario-form': 'Cadastro de Usuário',
            'perfis': 'Perfis de Acesso',
            'perfil-form': 'Cadastro de Perfil',
            'pastorais': 'Gestão de Pastorais',
            'pastoral-form': 'Cadastro de Pastoral',
            'relatorios': 'Central de Relatórios',
            'relatorio-servos-filtro': 'Escala de Servos - Filtros',
            'relatorio-servos-preview': 'Visualização do Relatório',
            'configuracoes': 'Configurações de Sistema'
        };
        const titleEl = document.getElementById('page-title');
        if (titleEl && titles[viewId]) titleEl.textContent = titles[viewId];

        /* Run logic based on view */
        if (viewId === 'dashboard') this.loadDashboard();
        if (viewId === 'dizimistas') this.loadDizimistas();
        if (viewId === 'novo-dizimista') this.setupNovoDizimista(params);
        if (viewId === 'recebimentos') {
            const now = new Date();
            const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
            const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
            
            setTimeout(() => {
                const inpIni = document.getElementById('filtro-data-ini');
                const inpFim = document.getElementById('filtro-data-fim');
                if (inpIni) inpIni.value = firstDay;
                if (inpFim) inpFim.value = lastDay;
                this.loadRecebimentosList(firstDay, lastDay);
            }, 10);
        }
        if (viewId === 'lancar-recebimento') this.setupLancarRecebimento();
        if (viewId === 'missas') this.loadMissas();
        if (viewId === 'missa-form') this.setupMissaForm();
        if (viewId === 'usuarios') this.loadUsuarios();
        if (viewId === 'usuario-form') this.setupUsuarioForm();
        if (viewId === 'perfis') this.loadPerfis();
        if (viewId === 'perfil-form') this.setupPerfilForm();
        if (viewId === 'pastorais') this.loadPastoraisList();
        if (viewId === 'pastoral-form') this.setupPastoralForm();
        if (viewId === 'relatorio-servos-filtro') this.setupRelatorioServosFiltro();
        if (viewId === 'configuracoes') this.setupConfiguracoes();
    },

    // --- View Implementations ---

    async loadDashboard(idMissa = '') {
        try {
            const res = await app.authFetch(`${API_URL}/dashboard`);
            if (res.ok) {
                const data = await res.json();
                document.getElementById('stat-dia').textContent = `R$ ${data.total_dia.toFixed(2)}`;
                document.getElementById('stat-mes').textContent = `R$ ${data.total_mes.toFixed(2)}`;
                document.getElementById('stat-ativos').textContent = data.dizimistas_ativos;
            }

            // Popular Missas de Hoje no Filtro do Dashboard
            const mRes = await app.authFetch(`${API_URL}/missas/hoje`);
            const mSelect = document.getElementById('filtro-missa-dashboard');
            if (mRes.ok && mSelect && mSelect.options.length <= 1) {
                const list = await mRes.json();
                list.forEach(m => {
                    const opt = document.createElement('option');
                    opt.value = m.id_missa;
                    opt.textContent = `${m.hora} - ${m.comunidade || ''}`;
                    mSelect.appendChild(opt);
                });

                if (!mSelect.dataset.listenerAttached) {
                    mSelect.addEventListener('change', (e) => {
                        this.loadDashboard(e.target.value);
                    });
                    mSelect.dataset.listenerAttached = 'true';
                }
            }

            // Controle do Botão de Imprimir Resumo
            const btnPrint = document.getElementById('btn-imprimir-resumo');
            if (btnPrint) {
                if (idMissa) {
                    btnPrint.style.display = 'inline-flex';
                    btnPrint.onclick = () => this.imprimirResumoMissa(idMissa);
                } else {
                    btnPrint.style.display = 'none';
                }
            }

            // Load today's payments
            let url = `${API_URL}/recebimentos?data_hoje=1&per_page=50`;
            if (idMissa) url += `&id_missa=${idMissa}`;

            const recRes = await app.authFetch(url);
            if (recRes.ok) {
                const response = await recRes.json();
                const recs = response.data || [];
                const tbody = document.getElementById('tb-recent');
                if (tbody) {
                    tbody.innerHTML = '';
                    if (recs.length === 0) {
                        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding: 1rem;">Nenhum lançamento encontrado para hoje</td></tr>';
                    }
                    recs.forEach(r => {
                        const tr = document.createElement('tr');
                        // Hora formatada: 14:30
                        const horaFmt = r.data_recebimento ? new Date(r.data_recebimento).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '-';
                        const isDespesa = r.tipo_lancamento_nome && r.tipo_lancamento_nome.toLowerCase().includes('despesa');

                        tr.innerHTML = `
                            <td>${horaFmt}</td>
                            <td><strong>${r.dizimista_nome}</strong></td>
                            <td>${r.tipo_lancamento_nome || '-'}</td>
                            <td><span class="badge" style="background:var(--bg-main); color:var(--primary-dark);">${r.tipo_pagamento_nome || '-'}</span></td>
                            <td>${r.competencia}</td>
                            <td style="color:${isDespesa ? 'var(--error-color)' : 'var(--success-color)'}; font-weight:bold;">R$ ${r.valor.toFixed(2)}</td>
                        `;
                        tbody.appendChild(tr);
                    });
                }
            }
        } catch (e) {
            console.error("Dashboard error", e);
        }
    },

    async imprimirResumoMissa(idMissa) {
        try {
            this.showToast('Gerando resumo da missa...');
            const res = await this.authFetch(`${API_URL}/missas/${idMissa}/resumo-financeiro`);
            if (res.ok) {
                const data = await res.json();

                // Formatação local
                const formatValue = (num) => 'R$ ' + (num || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

                document.getElementById('print-paroquia-nome').textContent = this.state.configs?.paroquia_nome || 'Paróquia';
                document.getElementById('print-missa-nome').textContent = data.comunidade || 'Comunidade';

                // Converter de YYYY-MM-DD para DD/MM/YYYY
                const parts = (data.data_missa || '').split('-');
                const dateFmt = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : data.data_missa;

                document.getElementById('print-data').textContent = dateFmt || '-';
                document.getElementById('print-hora').textContent = data.hora ? `${data.hora.split(':')[0]} h` : '-';

                document.getElementById('print-coleta-din').textContent = formatValue(data.totais.coleta_dinheiro);
                document.getElementById('print-coleta-car').innerHTML = data.totais.coleta_cartao === 0 ? '&mdash;' : formatValue(data.totais.coleta_cartao);
                document.getElementById('print-dizimo-din').innerHTML = data.totais.dizimo_dinheiro === 0 ? '&mdash;' : formatValue(data.totais.dizimo_dinheiro);
                document.getElementById('print-dizimo-car').innerHTML = data.totais.dizimo_cartao === 0 ? '&mdash;' : formatValue(data.totais.dizimo_cartao);

                // Popular Despesas dinâmicas
                const tbodyDespesas = document.getElementById('print-despesas-body');
                if (tbodyDespesas) {
                    tbodyDespesas.innerHTML = '';
                    const despesas = data.despesas || [];
                    if (despesas.length === 0) {
                        tbodyDespesas.innerHTML = `
                            <tr class="print-footer-row">
                                <th colspan="2" style="text-align: left;">Despesas R$ <span class="print-underline"></span></th>
                            </tr>
                        `;
                    } else {
                        // Linha de Header para Despesas
                        tbodyDespesas.innerHTML = `
                            <tr>
                                <th colspan="2" style="text-align: center; border-bottom: none; font-weight: bold; background: #f0f0f0;">Despesas da Missa</th>
                            </tr>
                        `;
                        // Iterar as despesas
                        despesas.forEach(d => {
                            const tr = document.createElement('tr');
                            tr.innerHTML = `
                                <td style="text-align: justify; word-break: break-word; white-space: normal;">${d.observacao || 'Despesa'}</td>
                                <td class="print-value-money" style="text-align: right !important; color: #8b0000; vertical-align: top;">${formatValue(d.valor)}</td>
                            `;
                            tbodyDespesas.appendChild(tr);
                        });

                        // Total de Despesas no final
                        const totalDespesas = despesas.reduce((sum, d) => sum + d.valor, 0);
                        const totalTr = document.createElement('tr');
                        totalTr.innerHTML = `
                            <th style="text-align: right;">Total Despesas:</th>
                            <th class="print-value-money" style="text-align: left !important; color: #8b0000; font-weight: bold;">${formatValue(totalDespesas)}</th>
                        `;
                        tbodyDespesas.appendChild(totalTr);
                    }
                }

                setTimeout(() => {
                    document.body.classList.add('print-resumo-missa');
                    // Injetar estilo dinâmico para tamanho A6
                    const style = document.createElement('style');
                    style.id = 'print-page-style';
                    style.innerHTML = '@page { size: 105mm 148mm; margin: 5mm; }';
                    document.head.appendChild(style);

                    window.print();

                    document.body.classList.remove('print-resumo-missa');
                    const dynamicStyle = document.getElementById('print-page-style');
                    if (dynamicStyle) dynamicStyle.remove();
                }, 300); // small delay to render
            } else {
                this.handleResponseError(res, 'Erro ao carregar resumo');
            }
        } catch (e) {
            console.error(e);
            this.showToast('Erro de conexão', 'error');
        }
    },

    async loadDizimistas(q = '', fonetica = '', page = 1, perPage = 10) {
        try {
            let url = `${API_URL}/dizimistas?page=${page}&per_page=${perPage}`;
            if (fonetica) {
                url += `&fonetica=${encodeURIComponent(fonetica)}`;
            } else if (q) {
                url += `&q=${encodeURIComponent(q)}`;
            }
            const res = await app.authFetch(url);
            if (res.ok) {
                const response = await res.json();
                const dizimistas = response.data;
                const total = response.total;

                const tbody = document.getElementById('tb-dizimistas');
                if (!tbody) return;
                tbody.innerHTML = '';

                if (dizimistas.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding: 2rem;">Nenhum dizimista encontrado</td></tr>';
                }

                dizimistas.forEach(d => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td>${d.id_dizimista}</td>
                        <td><strong>${d.nome}</strong></td>
                        <td>${d.cpf || '-'}</td>
                        <td>${d.telefone || '-'}</td>
                        <td><span class="badge ${d.status === 1 ? 'badge-success' : 'badge-danger'}">${d.status === 1 ? 'Ativo' : 'Inativo'}</span></td>
                        <td>
                            <button class="btn-icon btn-hist-diz" data-id="${d.id_dizimista}" data-nome="${d.nome}" title="Ver Histórico"><i class="ph ph-file-text"></i></button>
                            <button class="btn-icon btn-edit-diz" data-diz='${JSON.stringify(d)}' title="Editar"><i class="ph ph-pencil-simple"></i></button>
                            ${this.hasPermission('Excluir Dizimistas') ? `
                                <button class="btn-icon btn-del-diz" data-id="${d.id_dizimista}" data-nome="${d.nome}" title="Excluir" style="color:var(--error-color)"><i class="ph ph-trash"></i></button>
                            ` : ''}
                        </td>
                    `;
                    tbody.appendChild(tr);
                });

                this.renderPagination('pagination-dizimistas', total, page, perPage, (newPage, newPerPage) => {
                    this.loadDizimistas(q, fonetica, newPage, newPerPage);
                });

                document.querySelectorAll('.btn-edit-diz').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        const diz = JSON.parse(e.currentTarget.getAttribute('data-diz'));
                        this.navTo('novo-dizimista', diz);
                    });
                });

                document.querySelectorAll('.btn-hist-diz').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        const id = e.currentTarget.getAttribute('data-id');
                        const nome = e.currentTarget.getAttribute('data-nome');
                        this.openHistoricoModal(id, nome);
                    });
                });

                document.querySelectorAll('.btn-del-diz').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        const id = e.currentTarget.getAttribute('data-id');
                        const nome = e.currentTarget.getAttribute('data-nome');
                        if (confirm(`Deseja realmente inativar o dizimista ${nome}?`)) {
                            try {
                                const res = await this.authFetch(`${API_URL}/dizimistas/${id}`, { method: 'DELETE' });
                                if (res.ok) {
                                    this.showToast('Dizimista inativado com sucesso');
                                    this.loadDizimistas(q, fonetica, page, perPage);
                                } else {
                                    this.handleResponseError(res, 'Erro ao excluir');
                                }
                            } catch (e) {
                                this.showToast('Erro de conexão', 'error');
                            }
                        }
                    });
                });

                // Set up search listener only once per view render
                const searchInput = document.getElementById('search-dizimista');
                const foneticaInput = document.getElementById('search-fonetica');
                const btnToggle = document.getElementById('btn-toggle-fonetica');
                const normalWrap = document.getElementById('normal-search-wrapper');
                const foneticaWrap = document.getElementById('fonetica-search-wrapper');

                if (btnToggle && !btnToggle.dataset.listenerAttached) {
                    btnToggle.addEventListener('click', () => {
                        if (normalWrap.style.display !== 'none') {
                            normalWrap.style.display = 'none';
                            foneticaWrap.style.display = 'flex';
                            btnToggle.classList.remove('btn-secondary');
                            btnToggle.classList.add('btn-primary');
                            searchInput.value = '';
                            this.loadDizimistas('', foneticaInput.value, 1, perPage);
                        } else {
                            normalWrap.style.display = 'flex';
                            foneticaWrap.style.display = 'none';
                            btnToggle.classList.remove('btn-primary');
                            btnToggle.classList.add('btn-secondary');
                            foneticaInput.value = '';
                            this.loadDizimistas(searchInput.value, '', 1, perPage);
                        }
                    });
                    btnToggle.dataset.listenerAttached = 'true';
                }

                if (searchInput && !searchInput.dataset.listenerAttached) {
                    searchInput.addEventListener('input', (e) => {
                        this.loadDizimistas(e.target.value, '', 1, perPage);
                    });
                    searchInput.dataset.listenerAttached = 'true';
                    if (q) {
                        searchInput.value = q;
                        normalWrap.style.display = 'flex';
                        foneticaWrap.style.display = 'none';
                    }
                }

                if (foneticaInput && !foneticaInput.dataset.listenerAttached) {
                    foneticaInput.addEventListener('input', (e) => {
                        this.loadDizimistas('', e.target.value, 1, perPage);
                    });
                    foneticaInput.dataset.listenerAttached = 'true';
                    if (fonetica) {
                        foneticaInput.value = fonetica;
                        normalWrap.style.display = 'none';
                        foneticaWrap.style.display = 'flex';
                        btnToggle.classList.add('btn-primary');
                        btnToggle.classList.remove('btn-secondary');
                    }
                }
            }
        } catch (e) {
            this.showToast('Erro ao carregar dizimistas', 'error');
        }
    },

    renderPagination(containerId, total, currentPage, perPage, onPageChange) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const totalPages = Math.ceil(total / perPage) || 1;
        const startIdx = total === 0 ? 0 : (currentPage - 1) * perPage + 1;
        const endIdx = Math.min(currentPage * perPage, total);

        let html = `
            <div class="pagination-info">
                Mostrando <strong>${startIdx}</strong> - <strong>${endIdx}</strong> de <strong>${total}</strong> registros
            </div>
            <div class="pagination-controls">
                <button class="pagination-btn" ${currentPage === 1 ? 'disabled' : ''} id="page-prev">
                    <i class="ph ph-caret-left"></i>
                </button>
        `;

        // Render page numbers (simple version: current, and a few around)
        let startPage = Math.max(1, currentPage - 1);
        let endPage = Math.min(totalPages, startPage + 2);
        if (endPage - startPage < 2) startPage = Math.max(1, endPage - 2);

        for (let i = startPage; i <= endPage; i++) {
            html += `
                <button class="pagination-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">
                    ${i}
                </button>
            `;
        }

        html += `
                <button class="pagination-btn" ${currentPage === totalPages ? 'disabled' : ''} id="page-next">
                    <i class="ph ph-caret-right"></i>
                </button>
            </div>
            <div class="pagination-settings">
                <span>Registros por página:</span>
                <select class="per-page-select" id="per-page-select">
                    <option value="5" ${perPage === 5 ? 'selected' : ''}>5</option>
                    <option value="10" ${perPage === 10 ? 'selected' : ''}>10</option>
                    <option value="20" ${perPage === 20 ? 'selected' : ''}>20</option>
                    <option value="50" ${perPage === 50 ? 'selected' : ''}>50</option>
                </select>
            </div>
        `;

        container.innerHTML = html;

        // Event listeners
        const prevBtn = document.getElementById('page-prev');
        if (prevBtn) prevBtn.onclick = () => onPageChange(currentPage - 1, perPage);

        const nextBtn = document.getElementById('page-next');
        if (nextBtn) nextBtn.onclick = () => onPageChange(currentPage + 1, perPage);

        container.querySelectorAll('button[data-page]').forEach(btn => {
            btn.onclick = () => onPageChange(parseInt(btn.getAttribute('data-page')), perPage);
        });

        const select = document.getElementById('per-page-select');
        if (select) {
            select.onchange = (e) => onPageChange(1, parseInt(e.target.value));
        }
    },

    async openHistoricoModal(id, nome) {
        document.getElementById('hist-nome').textContent = nome;
        const tbodyHist = document.getElementById('tb-hist-pagamentos');
        tbodyHist.innerHTML = '<tr><td colspan="3" style="text-align:center;">Carregando...</td></tr>';
        document.getElementById('modal-historico').style.display = 'flex';

        try {
            const res = await app.authFetch(`${API_URL}/recebimentos?id_dizimista=${id}&per_page=100`);
            if (res.ok) {
                const response = await res.json();
                const recs = response.data || [];
                tbodyHist.innerHTML = '';

                const grouped = {};
                recs.forEach(r => {
                    if (!grouped[r.competencia]) grouped[r.competencia] = [];
                    grouped[r.competencia].push(r);
                });

                // Gerar 12 competências do ano atual
                const currentYear = new Date().getFullYear();
                for (let m = 1; m <= 12; m++) {
                    const compStr = `${m.toString().padStart(2, '0')}/${currentYear}`;
                    if (!grouped[compStr]) grouped[compStr] = [];
                }

                // Sorting decrescente
                const sortedComps = Object.keys(grouped).sort((a, b) => {
                    const [mA, yA] = a.split('/');
                    const [mB, yB] = b.split('/');
                    return (parseInt(yB) * 100 + parseInt(mB)) - (parseInt(yA) * 100 + parseInt(mA));
                });

                sortedComps.forEach(comp => {
                    const items = grouped[comp];
                    const total = items.reduce((sum, item) => sum + item.valor, 0);
                    const hasItems = items.length > 0;

                    const mainTr = document.createElement('tr');
                    mainTr.innerHTML = `
                        <td style="text-align:center; vertical-align:middle;">
                            ${hasItems
                            ? `<button class="btn-icon btn-toggle-details" style="font-size:1.5rem" title="Ver Detalhes"><i class="ph ph-plus-circle"></i></button>`
                            : `<button class="btn-icon btn-fast-pay" data-comp="${comp}" data-id="${id}" style="font-size:1.5rem; color:var(--primary-color)" title="Lançar Recebimento"><i class="ph ph-hand-coins"></i></button>`}
                        </td>
                        <td style="vertical-align:middle;"><strong>${comp}</strong></td>
                        <td style="vertical-align:middle; color:${hasItems ? 'var(--success-color)' : 'var(--text-muted)'};font-weight:bold;">
                            R$ ${total.toFixed(2).replace('.', ',')}
                        </td>
                    `;
                    tbodyHist.appendChild(mainTr);

                    if (hasItems) {
                        const detailsTr = document.createElement('tr');
                        detailsTr.style.display = 'none';
                        let detailsHtml = `<td colspan="3" style="padding:0; background:var(--bg-main);">
                            <div style="padding: 1rem 1rem 1rem 3rem; border-left: 3px solid var(--primary-light);">
                                <table style="width:100%; font-size:0.85rem; border-collapse:collapse;">
                                    <thead style="color:var(--text-muted); border-bottom:2px solid var(--border-color);">
                                        <tr>
                                            <th style="padding:0.5rem; text-align:left;">Data Pgto</th>
                                            <th style="padding:0.5rem; text-align:left;">Competência Ref.</th>
                                            <th style="padding:0.5rem; text-align:left;">Tipo</th>
                                            <th style="padding:0.5rem; text-align:right;">Valor</th>
                                        </tr>
                                    </thead>
                                    <tbody>`;
                        items.forEach(r => {
                            const dataFmt = r.data_recebimento ? new Date(r.data_recebimento).toLocaleDateString('pt-BR') : '-';
                            detailsHtml += `<tr style="border-bottom:1px solid rgba(0,0,0,0.05);">
                                <td style="padding:0.5rem;">${dataFmt}</td>
                                <td style="padding:0.5rem;">${r.competencia}</td>
                                <td style="padding:0.5rem;">${r.tipo_pagamento_nome || '-'}</td>
                                <td style="padding:0.5rem; text-align:right; font-weight:600;">R$ ${r.valor.toFixed(2).replace('.', ',')}</td>
                            </tr>`;
                        });
                        detailsHtml += `</tbody></table></div></td>`;
                        detailsTr.innerHTML = detailsHtml;
                        tbodyHist.appendChild(detailsTr);

                        const btnToggle = mainTr.querySelector('.btn-toggle-details');
                        btnToggle.addEventListener('click', () => {
                            const icon = btnToggle.querySelector('i');
                            if (detailsTr.style.display === 'none') {
                                detailsTr.style.display = '';
                                icon.classList.replace('ph-plus-circle', 'ph-minus-circle');
                            } else {
                                detailsTr.style.display = 'none';
                                icon.classList.replace('ph-minus-circle', 'ph-plus-circle');
                            }
                        });
                    } else {
                        const btnFastPay = mainTr.querySelector('.btn-fast-pay');
                        if (btnFastPay) {
                            btnFastPay.addEventListener('click', (ev) => {
                                document.getElementById('modal-historico').style.display = 'none';
                                app.state.prefillRecebimento = {
                                    id_dizimista: ev.currentTarget.getAttribute('data-id'),
                                    competencia: ev.currentTarget.getAttribute('data-comp'),
                                    dizimistaNome: nome
                                };
                                app.navTo('lancar-recebimento');
                            });
                        }
                    }
                });
            }
        } catch (err) {
            tbodyHist.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--error-color);">Erro ao carregar histórico.</td></tr>';
        }
    },

    setupNovoDizimista(diz = null) {
        console.log('Iniciando setupNovoDizimista', diz);
        const form = document.getElementById('form-dizimista');
        if (!form) {
            console.error('Formulário form-dizimista não encontrado!');
            return;
        }

        // Limpar listeners antigos clonando o form
        const newForm = form.cloneNode(true);
        form.parentNode.replaceChild(newForm, form);

        const btnGravar = newForm.querySelector('button[type="submit"]');
        const titleEl = document.getElementById('title-dizimista-form');

        // Se estiver editando, preencher formulário imediatamente
        if (diz) {
            this.fillDizimistaForm(diz, newForm); 
            if (titleEl) titleEl.textContent = 'Editar Dizimista';
            if (btnGravar) btnGravar.innerHTML = '<i class="ph ph-floppy-disk"></i> Gravar Alterações';
        } else {
            if (titleEl) titleEl.textContent = 'Novo Dizimista';
            const idInput = newForm.querySelector('#diz-id');
            if (idInput) idInput.value = '';
            newForm.reset();
            if (btnGravar) btnGravar.innerHTML = '<i class="ph ph-floppy-disk"></i> Salvar Cadastro';
        }

        // Escutador único para o formulário
        newForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            console.log('Formulário submetido');
            const id = newForm.querySelector('#diz-id').value;
            const data = {
                nome: newForm.querySelector('#diz-nome').value,
                apelido: newForm.querySelector('#diz-apelido').value,
                cpf: newForm.querySelector('#diz-cpf').value,
                telefone: newForm.querySelector('#diz-tel').value,
                email: newForm.querySelector('#diz-email').value,
                endereco: newForm.querySelector('#diz-endereco').value,
                bairro: newForm.querySelector('#diz-bairro').value,
                cidade: newForm.querySelector('#diz-cidade').value,
                cep: newForm.querySelector('#diz-cep').value,
                data_nascimento: newForm.querySelector('#diz-nascimento').value,
                valor_dizimo: parseFloat(newForm.querySelector('#diz-valor').value) || 0,
                observacoes: newForm.querySelector('#diz-observacoes').value,
                user_id: this.state.user ? this.state.user.id_usuario : 'sistema'
            };

            console.log('Dados para salvar:', data);

            // Validação de CPF
            if (data.cpf && !this.validarCPF(data.cpf)) {
                this.showToast('CPF Inválido. Por favor, verifique os dígitos.', 'error');
                return;
            }

            const method = id ? 'PUT' : 'POST';
            const url = id ? `${API_URL}/dizimistas/${id}` : `${API_URL}/dizimistas`;

            try {
                this.showToast('Salvando...', 'info');
                const res = await app.authFetch(url, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });

                console.log('Resposta do servidor:', res.status);

                if (res.ok) {
                    const resData = await res.json();
                    const newId = id || resData.id;

                    // Salvar vínculos pastorais
                    const pastoralListCont = newForm.querySelector('#diz-pastorais-list');
                    if (pastoralListCont) {
                        const selectedPastorais = Array.from(pastoralListCont.querySelectorAll('input[type="checkbox"]:checked')).map(cb => parseInt(cb.value));
                        await this.authFetch(`${API_URL}/dizimistas/${newId}/pastorais`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ pastorais: selectedPastorais })
                        });
                    }

                    this.showToast(id ? 'Dizimista atualizado com sucesso!' : 'Dizimista cadastrado com sucesso!');
                    this.navTo('dizimistas');
                } else {
                    const err = await res.json();
                    this.showToast(err.error || 'Erro ao salvar', 'error');
                }
            } catch (error) {
                console.error('Erro ao salvar:', error);
                this.showToast('Erro de conexão', 'error');
            }
        });

        // Configurar inputs no novo form
        const cpfInput = newForm.querySelector('#diz-cpf');
        const cepInput = newForm.querySelector('#diz-cep');

        if (cpfInput) {
            cpfInput.oninput = (e) => {
                let val = e.target.value.replace(/\D/g, '');
                if (val.length > 11) val = val.slice(0, 11);
                if (val.length > 9) val = val.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
                else if (val.length > 6) val = val.replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3');
                else if (val.length > 3) val = val.replace(/(\d{3})(\d{1,3})/, '$1.$2');
                e.target.value = val;
            };
        }

        if (cepInput) {
            cepInput.oninput = (e) => {
                let val = e.target.value.replace(/\D/g, '');
                if (val.length > 8) val = val.slice(0, 8);
                if (val.length > 5) val = val.replace(/(\d{5})(\d{1,3})/, '$1-$2');
                e.target.value = val;
            };

            cepInput.onblur = async () => {
                const cep = cepInput.value.replace(/\D/g, '');
                if (cep.length === 8) {
                    try {
                        cepInput.disabled = true;
                        const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
                        const data = await response.json();
                        if (!data.erro) {
                            newForm.querySelector('#diz-endereco').value = data.logradouro || '';
                            newForm.querySelector('#diz-bairro').value = data.bairro || '';
                            newForm.querySelector('#diz-cidade').value = data.localidade || '';
                        }
                    } catch (e) {} finally { cepInput.disabled = false; }
                }
            };
        }

        // Vínculo com Pastorais
        const loadPastoralCheckboxes = async () => {
            const pastoralListCont = newForm.querySelector('#diz-pastorais-list');
            if (!pastoralListCont) return;

            const pastorais = await this._getAllPastorais();
            pastoralListCont.innerHTML = 'Carregando...';
            
            let vinculadas = [];
            const dizId = newForm.querySelector('#diz-id').value;
            if (dizId) {
                const resV = await this.authFetch(`${API_URL}/dizimistas/${dizId}/pastorais`);
                if (resV.ok) vinculadas = await resV.json();
            }

            pastoralListCont.innerHTML = '';
            pastorais.forEach(p => {
                const item = document.createElement('label');
                item.className = 'pastoral-checkbox-item';
                item.innerHTML = `
                    <input type="checkbox" name="pastoral" value="${p.id_pastoral}" ${vinculadas.includes(p.id_pastoral) ? 'checked' : ''}>
                    <span>${p.nome}</span>
                `;
                pastoralListCont.appendChild(item);
            });
        };
        loadPastoralCheckboxes();
    },

    fillDizimistaForm(d, container = document) {
        const setVal = (id, val) => {
            const el = container.querySelector('#' + id);
            if (el) el.value = val || '';
        };
        setVal('diz-id', d.id_dizimista);
        setVal('diz-nome', d.nome);
        setVal('diz-apelido', d.apelido);
        setVal('diz-cpf', d.cpf);
        setVal('diz-tel', d.telefone);
        setVal('diz-email', d.email);
        setVal('diz-endereco', d.endereco);
        setVal('diz-bairro', d.bairro);
        setVal('diz-cidade', d.cidade);
        setVal('diz-cep', d.cep);
        
        let nasc = d.data_nascimento;
        if (nasc) {
            if (nasc.includes('T')) nasc = nasc.split('T')[0];
            if (nasc.includes(' ')) nasc = nasc.split(' ')[0];
        }
        setVal('diz-nascimento', nasc);
        setVal('diz-valor', d.valor_dizimo);
        setVal('diz-observacoes', d.observacoes);
    },

    async setupLancarRecebimento() {
        const searchInput = document.getElementById('rec-dizimista-search');
        const idInput = document.getElementById('rec-dizimista-id');
        const resultsDiv = document.getElementById('rec-dizimista-results');
        const btnToggleFonetica = document.getElementById('rec-btn-toggle-fonetica');
        let useFonetica = false;

        // Toggle fonetica
        if (btnToggleFonetica) {
            btnToggleFonetica.addEventListener('click', () => {
                useFonetica = !useFonetica;
                btnToggleFonetica.classList.toggle('btn-primary', useFonetica);
                btnToggleFonetica.classList.toggle('btn-secondary', !useFonetica);
                searchInput.placeholder = useFonetica ? "Busca fonética (pelo som)..." : "Digite nome ou CPF...";
                searchInput.focus();
                if (searchInput.value.length >= 2) searchInput.dispatchEvent(new Event('input'));
            });
        }

        // Autocomplete search
        let timeout = null;
        searchInput.addEventListener('input', () => {
            clearTimeout(timeout);
            const q = searchInput.value.trim();
            if (q.length < 2) {
                resultsDiv.style.display = 'none';
                return;
            }

            timeout = setTimeout(async () => {
                try {
                    let url = `${API_URL}/dizimistas?${useFonetica ? 'fonetica' : 'q'}=${encodeURIComponent(q)}&per_page=20`;
                    const res = await app.authFetch(url);
                    if (res.ok) {
                        const response = await res.json();
                        const list = response.data || [];
                        resultsDiv.innerHTML = '';
                        if (list.length === 0) {
                            resultsDiv.innerHTML = '<div class="autocomplete-item"><i>Nenhum dizimista encontrado</i></div>';
                        } else {
                            list.forEach(d => {
                                const item = document.createElement('div');
                                item.className = 'autocomplete-item';
                                item.innerHTML = `<strong>${d.nome}</strong><small>CPF: ${d.cpf || '-'} | Cel: ${d.telefone || '-'}</small>`;
                                item.addEventListener('click', async () => {
                                    searchInput.value = d.nome;
                                    idInput.value = d.id_dizimista;
                                    resultsDiv.style.display = 'none';

                                    // Verificar valor de dízimo ofertado
                                    if (d.valor_dizimo && parseFloat(d.valor_dizimo) > 0) {
                                        const valFmt = parseFloat(d.valor_dizimo).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                                        const usar = confirm(`💡 Dízimo Ofertado de ${d.nome}: ${valFmt}\n\nDeseja usar esse valor no lançamento?`);
                                        if (usar) {
                                            document.getElementById('rec-valor').value = parseFloat(d.valor_dizimo).toFixed(2);
                                        }
                                    }
                                });
                                resultsDiv.appendChild(item);
                            });
                        }
                        resultsDiv.style.display = 'block';
                    }
                } catch (e) {
                    console.error("Autocomplete error", e);
                }
            }, 300);
        });

        // Close results on click outside
        document.addEventListener('click', (e) => {
            if (!searchInput.contains(e.target) && !resultsDiv.contains(e.target)) {
                resultsDiv.style.display = 'none';
            }
        });

        // Load Tipos
        try {
            const [pRes, lRes] = await Promise.all([
                app.authFetch(`${API_URL}/tipos-pagamento`),
                app.authFetch(`${API_URL}/tipos-lancamentos`)
            ]);

            if (pRes.ok) {
                const tSelect = document.getElementById('rec-tipo');
                const list = await pRes.json();
                tSelect.innerHTML = '<option value="">Selecione...</option>';
                list.forEach(t => {
                    const opt = document.createElement('option');
                    opt.value = t.id_tipo_pagamento;
                    opt.textContent = t.descricao;
                    tSelect.appendChild(opt);
                });
            }

            if (lRes.ok) {
                const lSelect = document.getElementById('rec-tipo-lancamento');
                const list = await lRes.json();
                lSelect.innerHTML = '<option value="">Selecione...</option>';
                list.forEach(t => {
                    const opt = document.createElement('option');
                    opt.value = t.id_tipo_lancamento;
                    opt.textContent = t.descricao;
                    lSelect.appendChild(opt);
                    // Pre-fill with "Dízimo" if coming from history
                    if (this.state.prefillRecebimento && t.descricao.toLowerCase() === 'dízimo') {
                        lSelect.value = t.id_tipo_lancamento;
                    }
                });
            }
        } catch (e) { console.error("Error loading types", e); }

        // Carregar Missas (data de hoje)
        const localDate = new Date().toISOString().split('T')[0];
        try {
            const mRes = await app.authFetch(`${API_URL}/missas/hoje?data=${localDate}`);
            if (mRes.ok) {
                const mSelect = document.getElementById('rec-missa');
                const list = await mRes.json();
                if (mSelect) {
                    mSelect.innerHTML = '<option value="">Selecione...</option>';
                    list.forEach(m => {
                        const opt = document.createElement('option');
                        opt.value = m.id_missa;
                        opt.textContent = `${m.hora} - ${m.comunidade || ''} (${m.celebrante || ''})`;
                        mSelect.appendChild(opt);
                    });
                    if (list.length === 1) {
                        mSelect.value = list[0].id_missa;
                    }
                }
            }
        } catch (e) {
            console.error("Error loading today's masses", e);
        }

        // Prefill logic (when coming from historico)
        if (this.state.prefillRecebimento) {
            const pre = this.state.prefillRecebimento;
            idInput.value = pre.id_dizimista;
            // Fetch name and valor_dizimo for display
            try {
                const dRes = await app.authFetch(`${API_URL}/dizimistas/${pre.id_dizimista}`);
                if (dRes.ok) {
                    const d = await dRes.json();
                    searchInput.value = d.nome;
                    // Sugerir valor ofertado automaticamente
                    if (d.valor_dizimo && parseFloat(d.valor_dizimo) > 0) {
                        const valFmt = parseFloat(d.valor_dizimo).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                        const usar = confirm(`💡 Dízimo Ofertado de ${d.nome}: ${valFmt}\n\nDeseja usar esse valor no lançamento?`);
                        if (usar) {
                            document.getElementById('rec-valor').value = parseFloat(d.valor_dizimo).toFixed(2);
                        }
                    }
                }
            } catch (err) { }
            document.getElementById('rec-comp').value = pre.competencia;
            // Guardar id para retornar ao histórico após salvar
            this.state.prefillOrigemHistoricoId = pre.id_dizimista;
            this.state.prefillOrigemHistoricoNome = pre.dizimistaNome || '';
            this.state.prefillRecebimento = null;
        }

        document.getElementById('form-recebimento').addEventListener('submit', async (e) => {
            e.preventDefault();
            const dizId = idInput.value;
            if (!dizId) {
                this.showToast('Selecione um dizimista da lista', 'error');
                return;
            }

            const valor = parseFloat(document.getElementById('rec-valor').value);
            const competencia = document.getElementById('rec-comp').value;
            const idTipo = document.getElementById('rec-tipo').value;
            const idTipoLanc = document.getElementById('rec-tipo-lancamento').value;
            const idMissa = document.getElementById('rec-missa').value;
            const observacao = document.getElementById('rec-observacao').value;
            const isMult = document.getElementById('btn-parcela-multipla').classList.contains('active');

            // --- Validação de competência formato MM/AAAA ---
            if (!/^\d{2}\/\d{4}$/.test(competencia)) {
                this.showToast('Competência inválida. Use o formato MM/AAAA', 'error');
                return;
            }

            // Montar lista de parcelas a enviar
            let parcelas = [];
            if (!isMult) {
                // Parcela única
                parcelas = [{ valor, competencia }];
            } else {
                const numParcelas = parseInt(document.getElementById('rec-num-parcelas').value);
                if (!numParcelas || numParcelas < 2) {
                    this.showToast('Informe pelo menos 2 competencias', 'error');
                    return;
                }
                parcelas = this._calcularParcelas(valor, competencia, numParcelas);
            }

            // Confirmar antes de enviar múltiplas
            if (parcelas.length > 1) {
                const total = parcelas.reduce((s, p) => s + p.valor, 0);
                const lista = parcelas.map((p, i) => `  ${i + 1}. ${p.competencia} → R$ ${p.valor.toFixed(2).replace('.', ',')}`).join('\n');
                const ok = confirm(`Serão lançadas ${parcelas.length} parcelas:\n\n${lista}\n\nTotal: R$ ${total.toFixed(2).replace('.', ',')}\n\nConfirmar?`);
                if (!ok) return;
            }

            const btn = document.getElementById('btn-registrar-pagamento');
            btn.disabled = true;
            btn.innerHTML = '<i class="ph ph-circle-notch ph-spin"></i> Enviando...';

            let erros = 0;
            for (const parcela of parcelas) {
                try {
                    const res = await app.authFetch(`${API_URL}/recebimentos`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            id_dizimista: dizId,
                            valor: parcela.valor,
                            competencia: parcela.competencia,
                            id_tipo_pagamento: idTipo,
                            id_tipo_lancamento: idTipoLanc,
                            id_missa: idMissa || null,
                            observacao: observacao,
                            id_usuario: this.state.user.id_usuario
                        })
                    });
                    if (!res.ok) erros++;
                } catch {
                    erros++;
                }
            }

            btn.disabled = false;
            btn.innerHTML = '<i class="ph ph-paper-plane-tilt"></i> Registrar Pagamento';

            if (erros === 0) {
                this.showToast(parcelas.length > 1
                    ? `${parcelas.length} parcelas registradas com sucesso!`
                    : 'Recebimento registrado!');
            } else {
                this.showToast(`${erros} de ${parcelas.length} parcelas falharam`, 'error');
            }

            const origemId = this.state.prefillOrigemHistoricoId;
            const origemNome = this.state.prefillOrigemHistoricoNome;
            this.state.prefillOrigemHistoricoId = null;
            this.state.prefillOrigemHistoricoNome = null;
            if (origemId) {
                this.navTo('dizimistas');
                setTimeout(() => { this.openHistoricoModal(origemId, origemNome); }, 300);
            } else {
                this.navTo('dashboard');
            }
        });

        // ---- Parcelamento: toggle e preview ----
        this._setupParcelamentoUI();
    },

    /**
     * Configura os botões de toggle e o preview de parcelas.
     * Separado para não poluir setupLancarRecebimento.
     */
    _setupParcelamentoUI() {
        const btnUnica = document.getElementById('btn-parcela-unica');
        const btnMultipla = document.getElementById('btn-parcela-multipla');
        const multipDiv = document.getElementById('multiplas-options');
        const numInput = document.getElementById('rec-num-parcelas');
        const valorInput = document.getElementById('rec-valor');
        const compInput = document.getElementById('rec-comp');

        const atualizarPreview = () => {
            if (!btnMultipla.classList.contains('active')) return;
            const valor = parseFloat(valorInput.value);
            const comp = compInput.value;
            const num = parseInt(numInput.value);
            if (!valor || !comp || !num || num < 2 || !/^\d{2}\/\d{4}$/.test(comp)) {
                document.getElementById('rec-preview-parcela').textContent = '—';
                document.getElementById('rec-preview-lista').innerHTML = '';
                return;
            }
            const parcelas = this._calcularParcelas(valor, comp, num);
            // Preview do valor base
            document.getElementById('rec-preview-parcela').textContent =
                `R$ ${parcelas[0].valor.toFixed(2).replace('.', ',')}`;
            // Lista visual
            const lista = document.getElementById('rec-preview-lista');
            lista.innerHTML = '';
            parcelas.forEach((p, i) => {
                const isUltima = i === parcelas.length - 1;
                const div = document.createElement('div');
                div.className = 'parcela-preview-item' + (isUltima && parcelas.length > 1 ? ' pi-ajuste' : '');
                div.innerHTML = `
                    <span class="pi-idx">${i + 1}ª parcela</span>
                    <span class="pi-comp">${p.competencia}</span>
                    <span class="pi-valor">R$ ${p.valor.toFixed(2).replace('.', ',')}</span>
                `;
                lista.appendChild(div);
            });
        };

        btnUnica.addEventListener('click', () => {
            btnUnica.classList.add('active');
            btnMultipla.classList.remove('active');
            multipDiv.style.display = 'none';
        });
        btnMultipla.addEventListener('click', () => {
            btnMultipla.classList.add('active');
            btnUnica.classList.remove('active');
            multipDiv.style.display = 'block';
            atualizarPreview();
        });
        numInput.addEventListener('input', atualizarPreview);
        valorInput.addEventListener('input', atualizarPreview);
        compInput.addEventListener('input', atualizarPreview);
    },

    /**
     * Dado um valor total, uma competência inicial (MM/AAAA) e um número de parcelas,
     * retorna um array { valor, competencia } com a divisão exata.
     * A última parcela absorve a diferença de arredondamento.
     */
    _calcularParcelas(valorTotal, competenciaInicial, numParcelas) {
        // Valor base arredondado para baixo (2 casas)
        const base = Math.floor((valorTotal / numParcelas) * 100) / 100;
        const [mesStr, anoStr] = competenciaInicial.split('/');
        let mes = parseInt(mesStr);
        let ano = parseInt(anoStr);

        const parcelas = [];
        let somaAteAgora = 0;

        for (let i = 0; i < numParcelas; i++) {
            const compFormatada = `${String(mes).padStart(2, '0')}/${ano}`;
            let valorParcela;

            if (i === numParcelas - 1) {
                // Última parcela: recebe o restante exato para garantir soma perfeita
                valorParcela = Math.round((valorTotal - somaAteAgora) * 100) / 100;
            } else {
                valorParcela = base;
                somaAteAgora = Math.round((somaAteAgora + base) * 100) / 100;
            }

            parcelas.push({ valor: valorParcela, competencia: compFormatada });

            // Avançar mês
            mes++;
            if (mes > 12) { mes = 1; ano++; }
        }
        return parcelas;
    },

    voltarDeRecebimento() {
        const origemId = this.state.prefillOrigemHistoricoId;
        const origemNome = this.state.prefillOrigemHistoricoNome;
        // Limpar estado antes de navegar
        this.state.prefillOrigemHistoricoId = null;
        this.state.prefillOrigemHistoricoNome = null;
        this.state.prefillRecebimento = null;
        if (origemId) {
            this.navTo('dizimistas');
            setTimeout(() => this.openHistoricoModal(origemId, origemNome), 300);
        } else {
            this.navTo('dashboard');
        }
    },

    async loadUsuarios() {
        try {
            const res = await app.authFetch(`${API_URL}/usuarios`);
            if (res.ok) {
                const usuarios = await res.json();
                const tbody = document.getElementById('tb-usuarios');
                tbody.innerHTML = '';
                usuarios.forEach(u => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td><strong>${u.nome}</strong></td>
                        <td>${u.login}</td>
                        <td>${u.perfil_nome || '-'}</td>
                        <td style="font-size: 0.9rem; color: var(--text-muted);">${u.nome_dizimista || '-'}</td>
                        <td style="font-size: 0.85rem;">${u.ultimo_login ? new Date(u.ultimo_login).toLocaleString('pt-BR') : '-'}</td>
                        <td><span class="badge ${u.status === 1 ? 'badge-success' : 'badge-danger'}">${u.status === 1 ? 'Ativo' : 'Inativo'}</span></td>
                        <td>
                            <button class="btn-icon btn-edit-usr" data-user='${JSON.stringify(u)}' title="Editar"><i class="ph ph-pencil-simple"></i></button>
                            ${u.login !== 'admin' ? `<button class="btn-icon btn-del-usr" data-id="${u.id_usuario}" title="Inativar" style="color:var(--error-color)"><i class="ph ph-trash"></i></button>` : ''}
                        </td>
                    `;
                    tbody.appendChild(tr);
                });

                document.querySelectorAll('.btn-edit-usr').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        const usr = JSON.parse(e.currentTarget.getAttribute('data-user'));
                        this.navTo('usuario-form');
                        setTimeout(() => this.fillUsuarioForm(usr), 100);
                    });
                });

                document.querySelectorAll('.btn-del-usr').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        if (confirm('Deseja inativar este usuário?')) {
                            const id = e.currentTarget.getAttribute('data-id');
                            await app.authFetch(`${API_URL}/usuarios/${id}`, { method: 'DELETE' });
                            this.loadUsuarios();
                            this.showToast('Usuário inativado');
                        }
                    });
                });
            }
        } catch (e) {
            this.showToast('Erro ao carregar usuários', 'error');
        }
    },

    async loadPerfis() {
        try {
            const res = await app.authFetch(`${API_URL}/perfis`);
            if (res.ok) {
                const perfis = await res.json();
                const tbody = document.getElementById('tb-perfis');
                tbody.innerHTML = '';
                perfis.forEach(p => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td><strong>${p.descricao}</strong></td>
                        <td>
                            <button class="btn-icon btn-edit-prf" data-perfil='${JSON.stringify(p)}' title="Editar Permissões"><i class="ph ph-shield-check"></i></button>
                            ${p.descricao !== 'Admin' ? `<button class="btn-icon btn-del-prf" data-id="${p.id_perfil}" title="Excluir" style="color:var(--error-color)"><i class="ph ph-trash"></i></button>` : ''}
                        </td>
                    `;
                    tbody.appendChild(tr);
                });

                document.querySelectorAll('.btn-edit-prf').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        const prf = JSON.parse(e.currentTarget.getAttribute('data-perfil'));
                        this.navTo('perfil-form');
                        setTimeout(() => this.fillPerfilForm(prf), 100);
                    });
                });

                document.querySelectorAll('.btn-del-prf').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        if (confirm('Deseja excluir este perfil?')) {
                            const id = e.currentTarget.getAttribute('data-id');
                            const delRes = await app.authFetch(`${API_URL}/perfis/${id}`, { method: 'DELETE' });
                            if (delRes.ok) {
                                this.loadPerfis();
                                this.showToast('Perfil excluído');
                            } else {
                                const err = await delRes.json();
                                this.showToast(err.error || 'Erro', 'error');
                            }
                        }
                    });
                });
            }
        } catch (e) {
            this.showToast('Erro ao carregar perfis', 'error');
        }
    },

    _calcularProximasDatas(dataInicial, dataFinal, frequencia, diasSemana = []) {
        const datas = [];
        let atual = new Date(dataInicial + 'T12:00:00');
        const fim = new Date(dataFinal + 'T12:00:00');

        while (atual <= fim) {
            const dataIso = atual.toISOString().split('T')[0];
            
            if (frequencia === 'diaria' && diasSemana.length > 0) {
                const dia = atual.getDay(); // 0=Dom, 1=Seg, ..., 6=Sáb
                if (diasSemana.includes(dia)) {
                    datas.push(dataIso);
                }
            } else {
                datas.push(dataIso);
            }

            if (frequencia === 'diaria') {
                atual.setDate(atual.getDate() + 1);
            } else if (frequencia === 'semanal') {
                atual.setDate(atual.getDate() + 7);
            } else if (frequencia === 'mensal') {
                atual.setMonth(atual.getMonth() + 1);
            }
        }
        return datas;
    },

    async loadMissas(filtros = {}) {
        try {
            // Definir data padrão: 01 do mês corrente
            const now = new Date();
            const defaultDataDe = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

            const dataDe = filtros.dataDe || defaultDataDe;
            const dataAte = filtros.dataAte || '';
            const tipo = filtros.tipo || '';
            const celebrante = filtros.celebrante || '';

            // Montar URL com filtros
            let url = `${API_URL}/missas?order=asc`;
            if (dataDe) url += `&data_de=${dataDe}`;
            if (dataAte) url += `&data_ate=${dataAte}`;
            if (tipo) url += `&tipo=${encodeURIComponent(tipo)}`;
            if (celebrante) url += `&celebrante=${encodeURIComponent(celebrante)}`;

            const res = await app.authFetch(url);
            if (res.ok) {
                let missas = await res.json();

                // Garantir ordenação crescente por data no frontend (segurança extra)
                missas.sort((a, b) => {
                    const da = (a.data_missa || '').split('T')[0];
                    const db = (b.data_missa || '').split('T')[0];
                    if (da < db) return -1;
                    if (da > db) return 1;
                    // Mesmo dia: ordenar por hora
                    return (a.hora || '').localeCompare(b.hora || '');
                });

                const tbody = document.getElementById('tb-missas');
                if (!tbody) return;
                tbody.innerHTML = '';

                if (missas.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding: 2rem;">Nenhuma missa encontrada para os filtros selecionados</td></tr>';
                } else {
                    missas.forEach(m => {
                        const dataFmt = m.data_missa ? new Date(m.data_missa + 'T00:00').toLocaleDateString('pt-BR') : '-';

                        // Status de Vagas
                        let vagasStatus = `—`;
                        if (m.total_vagas > 0) {
                            const cor = m.preenchidas >= m.total_vagas ? 'var(--success-color)' : 'var(--error-color)';
                            vagasStatus = `<strong style="color:${cor}">${m.preenchidas} / ${m.total_vagas}</strong>`;
                        } else {
                            vagasStatus = `<span style="color:var(--text-muted); font-size: 0.8rem;">(Sem req.)</span>`;
                        }

                        const tr = document.createElement('tr');
                        tr.innerHTML = `
                                <td><strong>${dataFmt}</strong></td>
                                <td>${m.hora || '-'}</td>
                                <td>${m.comunidade || '-'}</td>
                                <td>${m.celebrante || '-'}</td>
                                <td><span class="badge badge-success">${m.tipo || '-'}</span></td>
                                <td style="text-align:center;">${vagasStatus}</td>
                                <td class="actions-cell">
                                    <button class="btn-icon btn-toggle-servos" data-id="${m.id_missa}" title="Ver Escala de Servos"><i class="ph ph-plus-circle" style="color:var(--primary-color)"></i></button>
                                    <button class="btn-icon btn-edit-missa" data-missa='${JSON.stringify(m)}' title="Editar"><i class="ph ph-pencil-simple"></i></button>
                                    <button class="btn-icon btn-del-missa" data-id="${m.id_missa}" title="Excluir" style="color:var(--error-color)"><i class="ph ph-trash"></i></button>
                                </td>
                            `;
                        tbody.appendChild(tr);
                    });
                }

                document.querySelectorAll('.btn-edit-missa').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        const m = JSON.parse(e.currentTarget.getAttribute('data-missa'));
                        this.state.editingMissa = m;
                        this.navTo('missa-form');
                    });
                });

                document.querySelectorAll('.btn-del-missa').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        if (confirm('Deseja excluir esta missa?')) {
                            const id = e.currentTarget.getAttribute('data-id');
                            const delRes = await app.authFetch(`${API_URL}/missas/${id}`, { method: 'DELETE' });
                            if (delRes.ok) {
                                this.showToast('Missa excluída!');
                                this.loadMissas(filtros);
                            } else {
                                await this.handleResponseError(delRes, 'Erro ao excluir');
                            }
                        }
                    });
                });

                document.querySelectorAll('.btn-toggle-servos').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        const id = e.currentTarget.getAttribute('data-id');
                        const row = e.currentTarget.closest('tr');
                        this.toggleMissaServos(row, id);
                    });
                });
            }
        } catch (e) {
            this.showToast('Erro ao carregar missas', 'error');
        }

        // Configurar listeners dos botões de filtro (uma só vez por render)
        const btnFiltrar = document.getElementById('btn-filtrar-missas');
        const btnLimpar = document.getElementById('btn-limpar-filtro-missas');

        const now = new Date();
        const defaultDataDe = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

        // Preencher data-de com o padrão se ainda estiver vazio
        const inputDe = document.getElementById('filtro-missa-data-de');
        if (inputDe && !inputDe.dataset.listenerAttached) {
            if (!inputDe.value) inputDe.value = defaultDataDe;
        }

        if (btnFiltrar && !btnFiltrar.dataset.listenerAttached) {
            btnFiltrar.addEventListener('click', () => {
                const f = {
                    dataDe: document.getElementById('filtro-missa-data-de')?.value || '',
                    dataAte: document.getElementById('filtro-missa-data-ate')?.value || '',
                    tipo: document.getElementById('filtro-missa-tipo')?.value || '',
                    celebrante: document.getElementById('filtro-missa-celebrante')?.value || ''
                };
                this.loadMissas(f);
            });
            btnFiltrar.dataset.listenerAttached = 'true';
        }

        if (btnLimpar && !btnLimpar.dataset.listenerAttached) {
            btnLimpar.addEventListener('click', () => {
                const inputDe = document.getElementById('filtro-missa-data-de');
                const inputAte = document.getElementById('filtro-missa-data-ate');
                const selTipo = document.getElementById('filtro-missa-tipo');
                const inpCel = document.getElementById('filtro-missa-celebrante');
                if (inputDe) inputDe.value = defaultDataDe;
                if (inputAte) inputAte.value = '';
                if (selTipo) selTipo.value = '';
                if (inpCel) inpCel.value = '';
                this.loadMissas();
            });
            btnLimpar.dataset.listenerAttached = 'true';
        }

        // Novo: Expandir/Recolher Tudo
        const btnToggleAll = document.getElementById('btn-toggle-all-missas');
        if (btnToggleAll && !btnToggleAll.dataset.listenerAttached) {
            btnToggleAll.addEventListener('click', () => this.toggleAllMissas());
            btnToggleAll.dataset.listenerAttached = 'true';
        }
    },

    async setupMissaForm() {
        const title = document.getElementById('title-missa-form');
        if (title) title.textContent = 'Nova Missa';

        const form = document.getElementById('form-missa');
        if (!form) return;

        // Clonamos para limpar eventos anteriores
        const newForm = form.cloneNode(true);
        form.parentNode.replaceChild(newForm, form);

        // Captura elementos dentro do formulário novo/ativo
        const idInput = newForm.querySelector('#missa-id');
        const dataInput = newForm.querySelector('#missa-data');
        const horaInput = newForm.querySelector('#missa-hora');
        const tipoSelect = newForm.querySelector('#missa-tipo');
        const comInput = newForm.querySelector('#missa-comunidade');
        const celInput = newForm.querySelector('#missa-celebrante');

        const chkRec = newForm.querySelector('#missa-recorrente');
        const optRec = newForm.querySelector('#missa-recorrente-options');
        const dataFimInput = newForm.querySelector('#missa-data-fim');
        const freqSelect = newForm.querySelector('#missa-frequencia');
        const sectionRec = newForm.querySelector('#section-recorrencia');

        // Pastorais dynamic list
        const pastoralContainer = newForm.querySelector('#missa-pastorais-container');
        const btnAddPastoral = newForm.querySelector('#btn-add-pastoral-missa');

        // Função para carregar pastorais no select
        const allPastorais = await this._getAllPastorais();

        const addPastoralRow = (selectedId = '', quantity = 1) => {
            const row = document.createElement('div');
            row.className = 'pastoral-row mt-2';
            row.innerHTML = `
                <div class="input-group">
                    <select class="p-select">
                        <option value="">Selecione Pastoral...</option>
                        ${allPastorais.map(p => `<option value="${p.id_pastoral}" ${p.id_pastoral == selectedId ? 'selected' : ''}>${p.nome}</option>`).join('')}
                    </select>
                </div>
                <div class="input-group" style="flex: 0 0 80px;">
                    <label style="font-size: 0.75rem;">Qtd</label>
                    <input type="number" class="p-qty" value="${quantity}" min="1">
                </div>
                <button type="button" class="btn-icon btn-remove-p" title="Remover"><i class="ph ph-trash"></i></button>
            `;
            row.querySelector('.btn-remove-p').onclick = () => row.remove();
            pastoralContainer.appendChild(row);
        };

        if (btnAddPastoral) {
            btnAddPastoral.onclick = () => addPastoralRow();
        }

        // Preenchimento (Novo vs Edição)
        if (this.state.editingMissa) {
            const m = this.state.editingMissa;
            document.getElementById('title-missa-form').textContent = 'Editar Missa';
            idInput.value = m.id_missa;

            let dt = m.data_missa || '';
            if (dt.includes('T')) dt = dt.split('T')[0];
            if (dt.includes(' ')) dt = dt.split(' ')[0];
            dataInput.value = dt;

            horaInput.value = m.hora || '';
            tipoSelect.value = m.tipo || '';
            comInput.value = m.comunidade || '';
            celInput.value = m.celebrante || '';

            if (m.pastorais && m.pastorais.length > 0) {
                m.pastorais.forEach(p => addPastoralRow(p.id_pastoral, p.quantidade));
            }
            if (sectionRec) sectionRec.style.display = 'none';

            delete this.state.editingMissa;
        } else {
            // Reset para Novo
            idInput.value = '';
            dataInput.value = '';
            horaInput.value = '';
            tipoSelect.value = '';
            comInput.value = '';
            celInput.value = '';
            dataFimInput.value = '';
            if (sectionRec) sectionRec.style.display = 'block';
        }

        if (chkRec && optRec) {
            chkRec.checked = false;
            optRec.style.display = 'none';
            chkRec.addEventListener('change', () => {
                optRec.style.display = chkRec.checked ? 'block' : 'none';
                if (chkRec.checked && freqSelect) {
                    const daysContainer = newForm.querySelector('#missa-dias-semana-container');
                    if (daysContainer) daysContainer.style.display = freqSelect.value === 'diaria' ? 'block' : 'none';
                }
            });
        }

        if (freqSelect) {
            freqSelect.addEventListener('change', () => {
                const daysContainer = newForm.querySelector('#missa-dias-semana-container');
                if (daysContainer) {
                    daysContainer.style.display = freqSelect.value === 'diaria' ? 'block' : 'none';
                }
            });
        }

        newForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = idInput.value;
            const isRec = chkRec ? chkRec.checked : false;

            // Coletar pastorais
            const pastoraisReq = [];
            newForm.querySelectorAll('.pastoral-row').forEach(r => {
                const p_id = r.querySelector('.p-select').value;
                const qty = r.querySelector('.p-qty').value;
                if (p_id) {
                    pastoraisReq.push({
                        id_pastoral: p_id,
                        quantidade: qty
                    });
                }
            });

            const baseData = {
                hora: horaInput.value,
                tipo: tipoSelect.value,
                comunidade: comInput.value,
                celebrante: celInput.value,
                pastorais: pastoraisReq
            };

            let datasParaSalvar = [];
            if (isRec && !id) { // Recorrência apenas no cadastro novo
                const dtIni = dataInput.value;
                const dtFim = dataFimInput.value;
                const freq = freqSelect.value;

                if (!dtIni || !dtFim) {
                    this.showToast('Informe a data inicial e final para a recorrência', 'error');
                    return;
                }
                
                let diasSemana = [];
                if (freq === 'diaria') {
                    diasSemana = Array.from(newForm.querySelectorAll('.missa-dia-chk:checked')).map(cb => parseInt(cb.value));
                    if (diasSemana.length === 0) {
                        this.showToast('Selecione pelo menos um dia da semana para a recorrência diária', 'warning');
                        return;
                    }
                }

                datasParaSalvar = this._calcularProximasDatas(dtIni, dtFim, freq, diasSemana);
            } else {
                const dt = dataInput.value;
                if (!dt) {
                    this.showToast('Informe a data da missa', 'error');
                    return;
                }
                datasParaSalvar = [dt];
            }

            if (datasParaSalvar.length > 1) {
                if (!confirm(`Deseja criar ${datasParaSalvar.length} missas?`)) return;
            }

            const btn = newForm.querySelector('button[type="submit"]');
            btn.disabled = true;
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="ph ph-circle-notch ph-spin"></i> Salvando...';

            let sucessos = 0;
            let erros = 0;
            let lastError = '';

            for (const dataMissa of datasParaSalvar) {
                try {
                    const method = id ? 'PUT' : 'POST';
                    const url = id ? `${API_URL}/missas/${id}` : `${API_URL}/missas`;
                    const res = await app.authFetch(url, {
                        method,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ...baseData, data_missa: dataMissa })
                    });

                    if (res.ok) {
                        sucessos++;
                    } else {
                        erros++;
                        const errData = await res.json().catch(() => ({}));
                        lastError = errData.error || 'Erro no servidor';
                    }
                } catch (err) {
                    erros++;
                    lastError = 'Erro de conexão';
                }
            }

            btn.disabled = false;
            btn.innerHTML = originalText;

            if (sucessos > 0) {
                this.showToast(id ? 'Missa atualizada!' : (datasParaSalvar.length > 1 ? `${sucessos} missas criadas!` : 'Missa cadastrada!'));
                this.navTo('missas');
            } else {
                // Se der um erro comum que já capturamos no loop, ele está em lastError
                this.showToast(lastError || 'Não foi possível salvar as missas. Verifique sua conexão ou permissões.', 'error');
            }
        });
    },

    async setupUsuarioForm() {
        document.getElementById('title-usuario-form').textContent = 'Novo Usuário';
        document.getElementById('usr-id').value = '';
        document.getElementById('usr-nome').value = '';
        document.getElementById('usr-login').value = '';
        document.getElementById('usr-senha').value = '';
        document.getElementById('usr-senha').required = true;
        document.getElementById('usr-dizimista-id').value = '';
        document.getElementById('usr-dizimista-search').value = '';

        try {
            const res = await app.authFetch(`${API_URL}/perfis`);
            if (res.ok) {
                const select = document.getElementById('usr-perfil');
                select.innerHTML = '<option value="">Selecione...</option>';
                const perfis = await res.json();
                perfis.forEach(p => {
                    select.innerHTML += `<option value="${p.id_perfil}">${p.descricao}</option>`;
                });
            }
        } catch (e) { }

        const form = document.getElementById('form-usuario');
        const newForm = form.cloneNode(true);
        form.parentNode.replaceChild(newForm, form);

        newForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('usr-id').value;
            const data = {
                nome: document.getElementById('usr-nome').value,
                login: document.getElementById('usr-login').value,
                id_perfil: document.getElementById('usr-perfil').value,
                senha: document.getElementById('usr-senha').value,
                id_dizimista: document.getElementById('usr-dizimista-id').value || null,
                trocar_senha: document.getElementById('usr-trocar-senha').checked,
                current_user_id: this.state.user.login
            };

            const method = id ? 'PUT' : 'POST';
            const url = id ? `${API_URL}/usuarios/${id}` : `${API_URL}/usuarios`;

            try {
                const res = await app.authFetch(url, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                if (res.ok) {
                    this.showToast('Usuário salvo com sucesso!');
                    this.navTo('usuarios');
                } else {
                    const err = await res.json();
                    this.showToast(err.error || 'Erro ao salvar', 'error');
                }
            } catch (error) {
                this.showToast('Erro de conexão', 'error');
            }
        });

        this._setupDizimistaSearchForUser(newForm);
    },

    fillUsuarioForm(u) {
        document.getElementById('title-usuario-form').textContent = 'Editar Usuário';
        document.getElementById('usr-id').value = u.id_usuario;
        document.getElementById('usr-nome').value = u.nome;
        document.getElementById('usr-login').value = u.login;
        document.getElementById('usr-dizimista-id').value = u.id_dizimista || '';
        document.getElementById('usr-dizimista-search').value = u.nome_dizimista || '';

        // Verifica existencia do perfil ciclicamente (robusto contra lentidão da nuvem)
        const setProfile = () => {
            const select = document.getElementById('usr-perfil');
            if (select && select.options.length > 1) {
                select.value = u.id_perfil;
            } else {
                setTimeout(setProfile, 50);
            }
        };
        setProfile();
        document.getElementById('usr-senha').required = false;
        document.getElementById('usr-trocar-senha').checked = u.trocar_senha == 1;
    },

    async setupPerfilForm() {
        document.getElementById('title-perfil-form').textContent = 'Novo Perfil';
        document.getElementById('prf-id').value = '';
        document.getElementById('prf-descricao').value = '';
        const container = document.getElementById('permissions-container');
        container.innerHTML = '';

        try {
            const res = await app.authFetch(`${API_URL}/permissoes`);
            if (res.ok) {
                const permissoes = await res.json();

                // Definição dos grupos de permissões
                const grupos = [
                    {
                        label: '📋 Dizimistas',
                        keywords: ['Dizimista']
                    },
                    {
                        label: '💰 Lançamentos',
                        keywords: ['Lançamento']
                    },
                    {
                        label: '⛪ Missas',
                        keywords: ['Missa']
                    },
                    {
                        label: '👥 Pastorais',
                        keywords: ['Pastoral', 'Pastorais']
                    },
                    {
                        label: '👥 Usuários',
                        keywords: ['Usuário', 'Perfil', 'Usuários', 'Perfis']
                    },
                    {
                        label: '⚙️ Outros',
                        keywords: [] // tudo que não foi agrupado
                    }
                ];

                const atribuidas = new Set();

                // Renderizar cada grupo exceto "Outros"
                grupos.slice(0, -1).forEach(grupo => {
                    const itens = permissoes.filter(p =>
                        grupo.keywords.some(kw => p.descricao.includes(kw))
                    );
                    if (itens.length === 0) return;
                    itens.forEach(p => atribuidas.add(p.id_permissao));

                    container.innerHTML += `
                        <div class="perm-group">
                            <div class="perm-group-header">${grupo.label}</div>
                            <div class="perm-group-items">
                                ${itens.map(p => `
                                    <div class="permission-item">
                                        <input type="checkbox" id="perm-${p.id_permissao}" value="${p.id_permissao}">
                                        <label for="perm-${p.id_permissao}">${p.descricao.replace(/Visualizar|Criar|Editar|Excluir/g, m => `<strong>${m}</strong>`)}</label>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `;
                });

                // Grupo "Outros" — permissões não atribuídas a nenhum grupo
                const outros = permissoes.filter(p => !atribuidas.has(p.id_permissao));
                if (outros.length > 0) {
                    container.innerHTML += `
                        <div class="perm-group">
                            <div class="perm-group-header">⚙️ Outros</div>
                            <div class="perm-group-items">
                                ${outros.map(p => `
                                    <div class="permission-item">
                                        <input type="checkbox" id="perm-${p.id_permissao}" value="${p.id_permissao}">
                                        <label for="perm-${p.id_permissao}">${p.descricao}</label>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `;
                }
            }
        } catch (e) { }

        const form = document.getElementById('form-perfil');
        const newForm = form.cloneNode(true);
        form.parentNode.replaceChild(newForm, form);

        newForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('prf-id').value;
            const desc = document.getElementById('prf-descricao').value;

            const method = id ? 'PUT' : 'POST';
            const url = id ? `${API_URL}/perfis/${id}` : `${API_URL}/perfis`;

            try {
                const res = await app.authFetch(url, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ descricao: desc })
                });

                if (res.ok) {
                    const savedPerfil = await res.json();
                    const targetId = id || savedPerfil.id;

                    const checkedPerms = Array.from(document.querySelectorAll('.permission-item input:checked')).map(cb => cb.value);
                    await app.authFetch(`${API_URL}/perfis/${targetId}/permissoes`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ permissoes: checkedPerms })
                    });

                    this.showToast('Perfil salvo com sucesso!');
                    this.navTo('perfis');
                } else {
                    this.showToast('Erro ao salvar', 'error');
                }
            } catch (error) {
                this.showToast('Erro de conexão', 'error');
            }
        });
    },

    async fillPerfilForm(p) {
        document.getElementById('title-perfil-form').textContent = 'Editar Perfil';
        document.getElementById('prf-id').value = p.id_perfil;
        document.getElementById('prf-descricao').value = p.descricao;

        try {
            const res = await app.authFetch(`${API_URL}/perfis/${p.id_perfil}/permissoes`);
            if (res.ok) {
                const checkedIds = await res.json();
                const setPerms = () => {
                    const checkboxes = document.querySelectorAll('.permission-item input');
                    if (checkboxes.length > 0) {
                        checkedIds.forEach(id => {
                            const cb = document.getElementById(`perm-${id}`);
                            if (cb) cb.checked = true;
                        });
                    } else {
                        setTimeout(setPerms, 50);
                    }
                };
                setPerms();
            }
        } catch (e) { }
    },

    // UI Helpers
    showToast(msg, type = 'success') {
        const container = document.getElementById('toast-container');
        const t = document.createElement('div');
        t.className = `toast ${type}`;
        t.innerHTML = `<i class="ph ph-${type === 'success' ? 'check-circle' : 'warning-circle'}"></i> <span>${msg}</span>`;
        container.appendChild(t);
        setTimeout(() => t.remove(), 3000);
    },

    async loadRecebimentosList(data_ini = '', data_fim = '', dizimista_id = '', page = 1, perPage = 10) {
        try {
            let url = `${API_URL}/recebimentos?page=${page}&per_page=${perPage}`;
            if (data_ini) url += `&data_ini=${data_ini}`;
            if (data_fim) url += `&data_fim=${data_fim}`;
            if (dizimista_id) url += `&id_dizimista=${dizimista_id}`;

            // Pré-preencher os filtros visuais apenas se vazios
            const inpIni = document.getElementById('filtro-data-ini');
            const inpFim = document.getElementById('filtro-data-fim');
            if (inpIni && !inpIni.value && data_ini) inpIni.value = data_ini;
            if (inpFim && !inpFim.value && data_fim) inpFim.value = data_fim;

            const selectFiltroDiz = document.getElementById('filtro-dizimista');
            if (selectFiltroDiz && selectFiltroDiz.options.length <= 1) {
                // Pedir 1000 para garantir que o filtro tenha bastantes opções (o ideal seria um autocomplete, mas mantendo a estrutura atual)
                const dRes = await app.authFetch(`${API_URL}/dizimistas?per_page=1000`);
                if (dRes.ok) {
                    const response = await dRes.json();
                    const list = response.data || [];
                    list.forEach(d => {
                        const opt = document.createElement('option');
                        opt.value = d.id_dizimista;
                        opt.textContent = `${d.nome} (${d.cpf || '-'})`;
                        selectFiltroDiz.appendChild(opt);
                    });
                }
            }

            const res = await app.authFetch(url);
            if (!res.ok) return;
            const response = await res.json();
            const recs = response.data || [];
            const totalCount = response.total || 0;

            const tbody = document.getElementById('tb-recebimentos');
            const totalBar = document.getElementById('rec-total-bar');
            if (!tbody) return;

            tbody.innerHTML = '';

            if (recs.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding: 2rem;">Nenhum lançamento encontrado</td></tr>';
            }

            // Calculando total apenas da página atual para exibição rápida ou total geral? 
            // O usuário pediu "Total filtrado". Para o total geral filtrado precisaríamos que o backend calculasse a soma.
            // Mas vamos manter a soma da página por enquanto ou remover se ficar confuso.
            // Decisão: Manter a soma do que está na página e indicar que é da página.
            const totalPagina = recs.reduce((sum, r) => sum + r.valor, 0);
            if (totalBar) {
                totalBar.innerHTML = totalCount > 0
                    ? `Total na página: <strong>R$ ${totalPagina.toFixed(2).replace('.', ',')}</strong> — Total de registros: <strong>${totalCount}</strong>`
                    : '';
            }

            recs.forEach(r => {
                const tr = document.createElement('tr');
                const dataFmt = r.data_recebimento
                    ? new Date(r.data_recebimento).toLocaleDateString('pt-BR')
                    : '-';
                tr.innerHTML = `
                    <td>${dataFmt}</td>
                    <td><strong>${r.dizimista_nome}</strong></td>
                    <td>${r.competencia}</td>
                    <td>${r.tipo_lancamento_nome || '-'}</td>
                    <td>${r.tipo_pagamento_nome || '-'}</td>
                    <td style="color:var(--success-color);font-weight:bold;">R$ ${r.valor.toFixed(2).replace('.', ',')}</td>
                    <td>
                        <button class="btn-icon btn-estornar" data-id="${r.id_recebimento}" title="Estornar" style="color:var(--error-color)">
                            <i class="ph ph-arrow-counter-clockwise"></i>
                        </button>
                    </td>
                `;
                tbody.appendChild(tr);
            });

            this.renderPagination('pagination-recebimentos', totalCount, page, perPage, (newPage, newPerPage) => {
                this.loadRecebimentosList(data_ini, data_fim, dizimista_id, newPage, newPerPage);
            });

            document.querySelectorAll('.btn-estornar').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    if (confirm('Confirma o estorno deste lançamento?')) {
                        const id = e.currentTarget.getAttribute('data-id');
                        const res = await app.authFetch(`${API_URL}/recebimentos/${id}`, { method: 'DELETE' });
                        if (res.ok) {
                            this.showToast('Estornado com sucesso');
                            this.loadRecebimentosList(
                                document.getElementById('filtro-data-ini')?.value || '',
                                document.getElementById('filtro-data-fim')?.value || '',
                                document.getElementById('filtro-dizimista')?.value || '',
                                page,
                                perPage
                            );
                        } else {
                            this.showToast('Erro ao estornar', 'error');
                        }
                    }
                });
            });

            // Bind filter buttons
            const btnFiltrar = document.getElementById('btn-filtrar');
            const btnLimpar = document.getElementById('btn-limpar-filtro');
            if (btnFiltrar && !btnFiltrar.dataset.bound) {
                btnFiltrar.addEventListener('click', () => {
                    const ini = document.getElementById('filtro-data-ini').value;
                    const fim = document.getElementById('filtro-data-fim').value;
                    const d = document.getElementById('filtro-dizimista') ? document.getElementById('filtro-dizimista').value : '';
                    this.loadRecebimentosList(ini, fim, d, 1, perPage);
                });
                btnFiltrar.dataset.bound = 'true';
            }
            if (btnLimpar && !btnLimpar.dataset.bound) {
                btnLimpar.addEventListener('click', () => {
                    document.getElementById('filtro-data-ini').value = '';
                    document.getElementById('filtro-data-fim').value = '';
                    if (document.getElementById('filtro-dizimista')) {
                        document.getElementById('filtro-dizimista').value = '';
                    }
                    this.loadRecebimentosList('', '', '', 1, perPage);
                });
                btnLimpar.dataset.bound = 'true';
            }

        } catch (e) {
            console.error(e);
            this.showToast('Erro ao carregar lançamentos', 'error');
        }
    },

    // --- Pastoral Management ---
    async loadPastoraisList() {
        try {
            const res = await this.authFetch(`${API_URL}/pastorais`);
            if (!res.ok) {
                this.handleResponseError(res, 'Erro ao carregar pastorais');
                return;
            }
            const pastorais = await res.json();
            const container = document.getElementById('pastorais-cards');
            if (!container) return;
            container.innerHTML = '';

            if (!Array.isArray(pastorais) || pastorais.length === 0) {
                container.innerHTML = `<div class="glass-panel" style="text-align:center; color:var(--text-muted); padding:2rem;">
                    <i class="ph ph-users-three" style="font-size:2rem;"></i><p>Nenhuma pastoral cadastrada.</p></div>`;
                return;
            }

            for (const p of pastorais) {
                if (!p) continue;
                console.log("Renderizando pastoral:", p);
                const card = document.createElement('div');
                card.className = 'glass-panel pastoral-card';
                card.dataset.pastoralId = p.id_pastoral;
                card.dataset.podeEditar = p.pode_editar;
                const pNome = p.nome || 'Sem Nome';
                const pId = p.id_pastoral || '0';

                const canEdit = this.hasPermission('Editar Pastorais') && p.pode_editar;
                const canDel = this.hasPermission('Excluir Pastorais') && p.pode_editar;

                card.innerHTML = `
                    <div class="pastoral-card-header" style="display:flex; justify-content:space-between; align-items:center; cursor:pointer; padding: 0.25rem 0;">
                        <div style="display:flex; align-items:center; gap:0.75rem;">
                            <i class="ph ph-caret-right pastoral-toggle-icon" style="transition:transform 0.25s; color:var(--primary-color); font-size:1.1rem;"></i>
                            <span style="font-weight:600; font-size:1.05rem;">${pNome}</span>
                            <span class="badge badge-success pastoral-count-badge" style="font-size:0.75rem;">carregando...</span>
                        </div>
                        <div class="actions-cell" style="gap:0.5rem;">
                            ${canEdit ? `
                                <button class="btn btn-secondary btn-sm btn-add-membro-pastoral" data-id="${pId}" data-nome="${pNome}" title="Adicionar Membro">
                                    <i class="ph ph-user-plus"></i> Membro
                                </button>
                                <button class="btn-icon btn-edit-pastoral" data-id="${p.id_pastoral}" title="Editar pastoral" style="color:var(--primary-color)">
                                    <i class="ph ph-pencil"></i>
                                </button>
                            ` : ''}
                            ${canDel ? `
                                <button class="btn-icon btn-del-pastoral" data-id="${p.id_pastoral}" title="Excluir pastoral" style="color:var(--error-color)">
                                    <i class="ph ph-trash"></i>
                                </button>
                            ` : ''}
                        </div>
                    </div>
                    <div class="pastoral-membros-container" style="display:none; margin-top:1rem; padding-top:1rem; border-top:1px dashed var(--border-color);">
                        <div class="pastoral-membros-list">
                            <span style="color:var(--text-muted); font-style:italic; font-size:0.9rem;">Carregando membros...</span>
                        </div>
                    </div>
                `;
                container.appendChild(card);

                // Toggle expansão
                const header = card.querySelector('.pastoral-card-header');
                const membrosContainer = card.querySelector('.pastoral-membros-container');
                const toggleIcon = card.querySelector('.pastoral-toggle-icon');

                header.addEventListener('click', async (e) => {
                    // Não fechar ao clicar nos botões de ação
                    if (e.target.closest('button')) return;
                    const isOpen = membrosContainer.style.display !== 'none';
                    if (isOpen) {
                        membrosContainer.style.display = 'none';
                        toggleIcon.style.transform = '';
                    } else {
                        membrosContainer.style.display = 'block';
                        toggleIcon.style.transform = 'rotate(90deg)';
                        await this._loadMembrosPastoral(p.id_pastoral, card);
                    }
                });

                // Botão Editar
                card.querySelector('.btn-edit-pastoral')?.addEventListener('click', () => this.editPastoral(p.id_pastoral));

                // Botão Excluir
                card.querySelector('.btn-del-pastoral')?.addEventListener('click', () => this.deletePastoral(p.id_pastoral));

                // Botão Adicionar Membro
                card.querySelector('.btn-add-membro-pastoral')?.addEventListener('click', () => {
                    this.openAddMembroModal(p.id_pastoral, p.nome, card);
                });

                // Carregar contagem inicial
                this._atualizarBadgeCount(p.id_pastoral, card);
            }
        } catch (error) {
            this.showToast('Erro ao carregar pastorais', 'error');
        }
    },

    async _atualizarBadgeCount(idPastoral, card) {
        try {
            const res = await this.authFetch(`${API_URL}/pastorais/${idPastoral}/membros`);
            if (res.ok) {
                const membros = await res.json();
                const badge = card.querySelector('.pastoral-count-badge');
                if (badge) badge.textContent = `${membros.length} membro${membros.length !== 1 ? 's' : ''}`;
            }
        } catch (e) { }
    },

    async _loadMembrosPastoral(idPastoral, card) {
        const listDiv = card.querySelector('.pastoral-membros-list');
        listDiv.innerHTML = '<span style="color:var(--text-muted); font-size:0.9rem; font-style:italic;">Carregando...</span>';

        // Recupera flag de edição persistida no card
        const podeEditarPastoral = card.dataset.podeEditar === 'true';
        const hasPermEdit = this.hasPermission('Editar Pastorais');
        const canEdit = podeEditarPastoral && hasPermEdit;

        try {
            const res = await this.authFetch(`${API_URL}/pastorais/${idPastoral}/membros`);
            if (!res.ok) throw new Error();
            const membros = await res.json();

            // Atualiza badge count
            const badge = card.querySelector('.pastoral-count-badge');
            if (badge) badge.textContent = `${membros.length} membro${membros.length !== 1 ? 's' : ''}`;

            if (membros.length === 0) {
                listDiv.innerHTML = `<p style="color:var(--text-muted); font-style:italic; font-size:0.9rem;">
                    <i class="ph ph-info"></i> Nenhum membro vinculado. Clique em "+ Membro" para adicionar.</p>`;
                return;
            }

            listDiv.innerHTML = '';

            // Separar coordenadores e servos para ordem visual
            const coordenadores = membros.filter(m => m.papel === 'C');
            const servos = membros.filter(m => m.papel !== 'C');

            const renderGrupo = (titulo, lista, isCoord) => {
                if (lista.length === 0) return;
                const header = document.createElement('div');
                header.style.cssText = 'font-size:0.78rem; font-weight:600; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:0.5rem; margin-top:0.75rem;';
                header.innerHTML = isCoord
                    ? `<i class="ph ph-star" style="color:#f59e0b;"></i> ${titulo}`
                    : `<i class="ph ph-users"></i> ${titulo}`;
                listDiv.appendChild(header);


                lista.forEach(m => {
                    const row = document.createElement('div');
                    row.className = 'membro-row';
                    row.dataset.dizId = m.id_dizimista;
                    row.style.cssText = 'display:flex; align-items:center; gap:0.75rem; padding:0.5rem 0.75rem; border-radius:var(--radius-md); background:var(--bg-main); margin-bottom:0.35rem;';
                    row.innerHTML = `
                        <i class="ph ${isCoord ? 'ph-star' : 'ph-user'}" style="color:${isCoord ? '#f59e0b' : 'var(--primary-color)'}; font-size:1.1rem; flex-shrink:0;"></i>
                        <span style="flex:1; font-weight:${isCoord ? '600' : '400'};">${m.nome}</span>
                        ${canEdit ? `
                            <label title="${isCoord ? 'Remover coordenador' : 'Promover a coordenador'}"
                                style="display:flex; align-items:center; gap:0.35rem; font-size:0.8rem; cursor:pointer; color:var(--text-muted);">
                                <input type="checkbox" class="chk-coordenador"
                                    data-diz-id="${m.id_dizimista}"
                                    data-pastoral-id="${idPastoral}"
                                    ${isCoord ? 'checked' : ''}
                                    style="width:auto; cursor:pointer; accent-color:#f59e0b;">
                                Coord.
                            </label>
                            <button class="btn-icon btn-rm-membro" data-diz-id="${m.id_dizimista}" data-pastoral-id="${idPastoral}"
                                title="Remover membro" style="color:var(--error-color); flex-shrink:0;">
                                <i class="ph ph-x-circle"></i>
                            </button>
                        ` : ''}
                    `;

                    // Checkbox alterar papel
                    row.querySelector('.chk-coordenador')?.addEventListener('change', async (e) => {
                        const novoPapel = e.target.checked ? 'coordenador' : 'servo';
                        await this.alterarPapelMembro(idPastoral, m.id_dizimista, novoPapel);
                        await this._loadMembrosPastoral(idPastoral, card);
                    });

                    // Botão remover
                    row.querySelector('.btn-rm-membro')?.addEventListener('click', async () => {
                        await this.removerMembroPastoral(idPastoral, m.id_dizimista, m.nome);
                        await this._loadMembrosPastoral(idPastoral, card);
                        this._atualizarBadgeCount(idPastoral, card);
                    });

                    listDiv.appendChild(row);
                });
            };

            renderGrupo('Coordenadores', coordenadores, true);
            renderGrupo('Servos', servos, false);

        } catch (e) {
            listDiv.innerHTML = '<span style="color:var(--error-color);">Erro ao carregar membros.</span>';
        }
    },

    openAddMembroModal(idPastoral, nomePastoral, card) {
        const modal = document.getElementById('modal-add-membro');
        if (!modal) return;

        document.getElementById('membro-id-pastoral').value = idPastoral;
        document.getElementById('membro-id-dizimista').value = '';
        document.getElementById('membro-search').value = '';
        document.getElementById('papel-servo').checked = true;
        document.getElementById('membro-search-results').style.display = 'none';
        modal.querySelector('h3').innerHTML = `<i class="ph ph-user-plus"></i> Adicionar Membro em "${nomePastoral}"`;

        modal.style.display = 'flex';

        // Setup autocomplete (se não foi feito ainda)
        this._setupAddMembroModal(card);
    },

    _setupAddMembroModal(card) {
        const searchInput = document.getElementById('membro-search');
        const idInput = document.getElementById('membro-id-dizimista');
        const resultsDiv = document.getElementById('membro-search-results');
        const btnConfirmar = document.getElementById('btn-confirmar-add-membro');

        // Limpar listeners anteriores clonando
        const newSearch = searchInput.cloneNode(true);
        searchInput.parentNode.replaceChild(newSearch, searchInput);
        const newBtn = btnConfirmar.cloneNode(true);
        btnConfirmar.parentNode.replaceChild(newBtn, btnConfirmar);

        let searchTimeout = null;
        newSearch.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            const q = newSearch.value.trim();
            idInput.value = '';
            if (q.length < 2) { resultsDiv.style.display = 'none'; return; }

            searchTimeout = setTimeout(async () => {
                try {
                    const res = await this.authFetch(`${API_URL}/dizimistas?q=${encodeURIComponent(q)}&per_page=20`);
                    if (res.ok) {
                        const data = await res.json();
                        const list = data.data || [];
                        resultsDiv.innerHTML = '';
                        if (list.length === 0) {
                            resultsDiv.innerHTML = '<div class="autocomplete-item"><i>Nenhum resultado</i></div>';
                        } else {
                            list.forEach(d => {
                                const item = document.createElement('div');
                                item.className = 'autocomplete-item';
                                item.innerHTML = `<strong>${d.nome}</strong><small>CPF: ${d.cpf || '-'}</small>`;
                                item.addEventListener('click', () => {
                                    newSearch.value = d.nome;
                                    idInput.value = d.id_dizimista;
                                    resultsDiv.style.display = 'none';
                                });
                                resultsDiv.appendChild(item);
                            });
                        }
                        resultsDiv.style.display = 'block';
                    }
                } catch (e) { }
            }, 300);
        });

        document.addEventListener('click', (e) => {
            if (!newSearch.contains(e.target) && !resultsDiv.contains(e.target)) {
                resultsDiv.style.display = 'none';
            }
        });

        newBtn.addEventListener('click', async () => {
            const idPastoral = document.getElementById('membro-id-pastoral').value;
            const idDizimista = idInput.value;
            const papel = document.querySelector('input[name="membro-papel"]:checked')?.value || 'servo';

            if (!idDizimista) {
                this.showToast('Selecione um dizimista da lista', 'error');
                return;
            }

            try {
                const res = await this.authFetch(`${API_URL}/pastorais/${idPastoral}/membros`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id_dizimista: parseInt(idDizimista), papel })
                });
                if (res.ok) {
                    this.showToast('Membro adicionado com sucesso!');
                    document.getElementById('modal-add-membro').style.display = 'none';
                    // Atualiza os membros do card correspondente
                    if (card) {
                        const membrosContainer = card.querySelector('.pastoral-membros-container');
                        if (membrosContainer.style.display !== 'none') {
                            await this._loadMembrosPastoral(idPastoral, card);
                        }
                        this._atualizarBadgeCount(idPastoral, card);
                    }
                } else {
                    const err = await res.json();
                    this.showToast(err.error || 'Erro ao adicionar membro', 'error');
                }
            } catch (e) {
                this.showToast('Erro de conexão', 'error');
            }
        });
    },

    async alterarPapelMembro(idPastoral, idDizimista, papel) {
        try {
            const res = await this.authFetch(`${API_URL}/pastorais/${idPastoral}/membros/${idDizimista}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ papel })
            });
            if (res.ok) {
                this.showToast(`Papel alterado para ${papel === 'coordenador' ? 'Coordenador' : 'Servo'}`);
            } else {
                const err = await res.json();
                this.showToast(err.error || 'Erro ao alterar papel', 'error');
            }
        } catch (e) {
            this.showToast('Erro de conexão', 'error');
        }
    },

    async removerMembroPastoral(idPastoral, idDizimista, nome) {
        if (!confirm(`Remover "${nome}" desta pastoral?`)) return;
        try {
            const res = await this.authFetch(`${API_URL}/pastorais/${idPastoral}/membros/${idDizimista}`, { method: 'DELETE' });
            if (res.ok) {
                this.showToast('Membro removido');
            } else {
                this.showToast('Erro ao remover membro', 'error');
            }
        } catch (e) {
            this.showToast('Erro de conexão', 'error');
        }
    },

    async setupPastoralForm() {
        const form = document.getElementById('form-pastoral');
        const idInput = document.getElementById('pastoral-id');
        const nomeInput = document.getElementById('pastoral-nome');

        if (this.state.editingPastoral) {
            idInput.value = this.state.editingPastoral.id_pastoral;
            nomeInput.value = this.state.editingPastoral.nome;
            document.getElementById('title-pastoral-form').textContent = 'Editar Pastoral';
            delete this.state.editingPastoral;
        }

        form.onsubmit = async (e) => {
            e.preventDefault();
            const payload = { nome: nomeInput.value };
            const id = idInput.value;
            const method = id ? 'PUT' : 'POST';
            const url = id ? `${API_URL}/pastorais/${id}` : `${API_URL}/pastorais`;

            try {
                const res = await this.authFetch(url, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (res.ok) {
                    this.showToast('Pastoral salva com sucesso');
                    this.navTo('pastorais');
                } else {
                    this.handleResponseError(res);
                }
            } catch (error) {
                this.showToast('Erro de conexão', 'error');
            }
        };
    },

    async editPastoral(id) {
        try {
            const res = await this.authFetch(`${API_URL}/pastorais`);
            const pastorais = await res.json();
            const p = pastorais.find(x => x.id_pastoral === id);
            this.state.editingPastoral = p;
            this.navTo('pastoral-form');
        } catch (error) {
            this.showToast('Erro ao buscar detalhes da pastoral', 'error');
        }
    },

    async deletePastoral(id) {
        if (!confirm('Deseja realmente excluir esta pastoral?')) return;
        try {
            const res = await this.authFetch(`${API_URL}/pastorais/${id}`, { method: 'DELETE' });
            if (res.ok) {
                this.showToast('Pastoral excluída');
                this.loadPastoraisList();
            } else {
                this.handleResponseError(res);
            }
        } catch (error) {
            this.showToast('Erro ao excluir', 'error');
        }
    },

    async _getAllPastorais() {
        try {
            const res = await this.authFetch(`${API_URL}/pastorais`);
            if (res.ok) return await res.json();
            return [];
        } catch (e) { return []; }
    },

    _setupDizimistaSearchForUser(container) {
        const input = container.querySelector('#usr-dizimista-search');
        const hiddenId = container.querySelector('#usr-dizimista-id');
        const results = container.querySelector('#usr-dizimista-results');

        if (!input) return;

        input.addEventListener('input', async () => {
            const q = input.value.trim();
            if (q.length < 2) {
                results.style.display = 'none';
                hiddenId.value = ''; // Limpa o ID se o usuário apagar a busca
                return;
            }

            try {
                // Correção: Usa a rota padrão de busca paginada e trata o formato {data:[]}
                const res = await app.authFetch(`${API_URL}/dizimistas?q=${encodeURIComponent(q)}&per_page=20`);
                if (res.ok) {
                    const responseJson = await res.json();
                    const data = responseJson.data || []; // A API retorna { data: [...] }

                    results.innerHTML = '';
                    if (data.length > 0) {
                        data.forEach(d => {
                            const item = document.createElement('div');
                            item.className = 'autocomplete-item';
                            item.innerHTML = `<strong>${d.nome}</strong><small>CPF: ${d.cpf || '—'}</small>`;
                            item.addEventListener('click', () => {
                                input.value = d.nome;
                                hiddenId.value = d.id_dizimista;
                                results.style.display = 'none';
                            });
                            results.appendChild(item);
                        });
                        results.style.display = 'block';
                    } else {
                        results.innerHTML = '<div class="autocomplete-item"><i>Nenhum dizimista encontrado</i></div>';
                        results.style.display = 'block';
                    }
                }
            } catch (e) { }
        });

        document.addEventListener('click', (e) => {
            if (!container.contains(e.target)) results.style.display = 'none';
        });
    },

    async toggleAllMissas() {
        const buttons = document.querySelectorAll('.btn-toggle-servos');
        if (buttons.length === 0) return;

        // Se todos estiverem abertos, vamos fechar todos. Caso contrário, abrimos os que faltam.
        const allOpen = Array.from(buttons).every(btn => btn.querySelector('i').classList.contains('ph-minus-circle'));
        
        for (const btn of buttons) {
            const row = btn.closest('tr');
            const missaId = btn.getAttribute('data-id');
            const isOpen = btn.querySelector('i').classList.contains('ph-minus-circle');

            if (allOpen) {
                if (isOpen) await this.toggleMissaServos(row, missaId);
            } else {
                if (!isOpen) await this.toggleMissaServos(row, missaId);
            }
        }
        
        // Atualiza o ícone do botão mestre
        const masterBtnIcon = document.querySelector('#btn-toggle-all-missas i');
        if (masterBtnIcon) {
            if (allOpen) {
                masterBtnIcon.classList.replace('ph-minus-circle', 'ph-plus-circle');
            } else {
                masterBtnIcon.classList.replace('ph-plus-circle', 'ph-minus-circle');
            }
        }
    },

    async toggleMissaServos(row, missaId) {
        const nextRow = row.nextElementSibling;
        if (nextRow && nextRow.classList.contains('servos-details-row')) {
            nextRow.remove();
            row.querySelector('.btn-toggle-servos i').classList.replace('ph-minus-circle', 'ph-plus-circle');
            return;
        }

        // Collapse others if wanted? (Optional)
        row.querySelector('.btn-toggle-servos i').classList.replace('ph-plus-circle', 'ph-minus-circle');

        const detailsTr = document.createElement('tr');
        detailsTr.className = 'servos-details-row';
        detailsTr.innerHTML = `<td colspan="7" style="padding:0;"><div id="servos-cont-${missaId}" class="servos-details-container">Carregando escala...</div></td>`;
        row.after(detailsTr);

        this.renderMissaServos(missaId);
    },

    async renderMissaServos(missaId) {
        const container = document.getElementById(`servos-cont-${missaId}`);
        if (!container) return;

        try {
            // Buscar os requisitos da missa (já temos no state ou buscamos)
            const resM = await this.authFetch(`${API_URL}/missas/${missaId}`);
            if (!resM.ok) throw new Error();
            const missa = await resM.json();

            // Buscar servos já escalados
            const resS = await this.authFetch(`${API_URL}/missas/${missaId}/servos`);
            const servos = resS.ok ? await resS.json() : [];

            let html = `<h3><i class="ph ph-users-three"></i> Escala de Servos - ${missa.tipo}</h3><div class="mt-4">`;

            if (!missa.pastorais || missa.pastorais.length === 0) {
                html += '<p style="color:var(--text-muted); font-style:italic;">Nenhum requisito de pastoral definido para esta missa.</p>';
            } else {
                const isAdmin = parseInt(this.state.user?.id_perfil) === 1;
                const userPastorais = this.state.user?.pastorais || [];

                missa.pastorais.forEach(req => {
                    // Filtrar pastorais: Adm vê tudo, outros só onde participam
                    if (!isAdmin && !userPastorais.includes(req.id_pastoral)) {
                        return;
                    }

                    const servsDestaPastoral = servos.filter(s => s.id_pastoral === req.id_pastoral);

                    html += `
                        <div class="pastoral-servos-group">
                            <h4 style="display:flex; align-items:center; gap:0.5rem;">
                                <i class="ph ph-bookmark-simple"></i> 
                                ${req.pastoral_nome || 'Pastoral'} (${req.quantidade} vagas)
                                <button class="btn-icon btn-add-vaga" onclick="app.incrementPastoralReq(${missaId}, ${req.id_pastoral})" title="Aumentar vagas para esta missa">
                                    <i class="ph ph-plus-circle" style="color:var(--success-color); font-size:1.2rem;"></i>
                                </button>
                            </h4>
                            <div class="servos-slots-grid">
                    `;

                    // Renderizar vagas preenchidas
                    servsDestaPastoral.forEach(s => {
                        html += `
                            <div class="servo-slot assigned">
                                <div class="servo-info">
                                    <i class="ph ph-user-check"></i>
                                    <span>${s.dizimista_nome}</span>
                                </div>
                                <button class="btn-remove-servo" onclick="app.removeMissaServo(${s.id_missa_servo}, ${missaId})" title="Remover da escala">
                                    <i class="ph ph-x-circle"></i>
                                </button>
                            </div>
                        `;
                    });

                    // Renderizar vagas vazias (slots restantes)
                    const vagasRestantes = req.quantidade - servsDestaPastoral.length;
                    for (let i = 0; i < vagasRestantes; i++) {
                        html += `
                            <div class="servo-slot">
                                <div class="servo-info">
                                    <i class="ph ph-user-plus"></i>
                                    <span style="color:var(--text-muted); font-style:italic;">Vaga disponível</span>
                                </div>
                                <button class="btn-assign" onclick="app.openAssignServoModal(${missaId}, ${req.id_pastoral}, '${req.pastoral_nome}')">
                                    Escalar
                                </button>
                            </div>
                        `;
                    }

                    html += `</div></div>`;
                });
            }

            html += '</div>';
            container.innerHTML = html;
        } catch (err) {
            container.innerHTML = '<p style="color:var(--error-color);">Erro ao carregar detalhes da escala.</p>';
        }
    },

    async openAssignServoModal(missaId, pastoralId, pastoralNome) {
        const modal = document.getElementById('modal-select-servo');
        const select = document.getElementById('select-servo-dizimista');
        const label = document.getElementById('servo-pastoral-label');
        const btn = document.getElementById('btn-confirm-assign');

        label.textContent = `Escalando para: ${pastoralNome}`;
        select.innerHTML = '<option value="">Carregando membros...</option>';
        modal.style.display = 'flex';

        try {
            const res = await this.authFetch(`${API_URL}/pastorais/${pastoralId}/membros`);
            if (res.ok) {
                const membros = await res.json();
                if (membros.length === 0) {
                    select.innerHTML = '<option value="">Nenhum membro vinculado a esta pastoral</option>';
                } else {
                    select.innerHTML = '<option value="">Selecione um membro...</option>';
                    const userDizId = this.state.user?.id_dizimista;
                    membros.forEach(m => {
                        const isUser = (userDizId && m.id_dizimista == userDizId);
                        select.innerHTML += `<option value="${m.id_dizimista}" ${isUser ? 'selected' : ''}>${m.nome}</option>`;
                    });
                }
            }
        } catch (e) {
            select.innerHTML = '<option value="">Erro ao carregar membros</option>';
        }

        btn.onclick = async () => {
            const dizId = select.value;
            if (!dizId) return alert('Selecione um dizimista');

            const res = await this.authFetch(`${API_URL}/missas/${missaId}/servos`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id_pastoral: pastoralId, id_dizimista: dizId })
            });

            if (res.ok) {
                modal.style.display = 'none';
                this.renderMissaServos(missaId);
                this.showToast('Membro escalado!');
            } else {
                const err = await res.json();
                alert(err.error || 'Erro ao escalar membro');
            }
        };
    },

    async removeMissaServo(vinculoId, missaId) {
        if (!confirm('Deseja remover este membro da escala?')) return;
        const res = await this.authFetch(`${API_URL}/missas/servos/${vinculoId}`, { method: 'DELETE' });
        if (res.ok) {
            this.renderMissaServos(missaId);
            this.showToast('Membro removido da escala');
        }
    },

    async incrementPastoralReq(missaId, pastoralId) {
        try {
            const res = await this.authFetch(`${API_URL}/missas/${missaId}/pastorais/${pastoralId}/increment`, {
                method: 'POST'
            });
            if (res.ok) {
                this.renderMissaServos(missaId);
                this.showToast('Vaga adicionada!');
            } else {
                const err = await res.json();
                this.showToast(err.error || 'Erro ao aumentar vagas', 'error');
            }
        } catch (e) {
            this.showToast('Erro de conexão', 'error');
        }
    },

    // --- Relatórios Logic ---

    async setupRelatorioServosFiltro() {
        const form = document.getElementById('form-relatorio-servos');
        const pastList = document.getElementById('rel-servos-pastorais-list');

        // Datas padrão (mês atual)
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

        const inicioEl = document.getElementById('rel-servos-inicio');
        const fimEl = document.getElementById('rel-servos-fim');
        if (inicioEl) inicioEl.value = firstDay;
        if (fimEl) fimEl.value = lastDay;

        // Carregar pastorais
        if (pastList) {
            try {
                const res = await this.authFetch(`${API_URL}/pastorais`);
                if (res.ok) {
                    const pastorais = await res.json();
                    pastList.innerHTML = '';
                    pastorais.forEach(p => {
                        const item = document.createElement('label');
                        item.className = 'pastoral-checkbox-item';
                        item.innerHTML = `<input type="checkbox" name="pastorais" value="${p.id_pastoral}"> <span>${p.nome}</span>`;
                        pastList.appendChild(item);
                    });
                }
            } catch (e) { }
        }

        if (form) {
            form.onsubmit = async (e) => {
                e.preventDefault();
                const start = document.getElementById('rel-servos-inicio').value;
                const end = document.getElementById('rel-servos-fim').value;
                const selected = Array.from(form.querySelectorAll('input[name="pastorais"]:checked')).map(v => v.value);

                this.state.relFilters = { start, end, pastorais: selected.join(',') };
                this.navTo('relatorio-servos-preview');
                this.gerarRelatorioServos(start, end, selected.join(','));
            };
        }
    },

    async gerarRelatorioServos(start, end, pastorais) {
        const container = document.getElementById('relatorio-servos-content');
        if (!container) return;

        try {
            const url = `${API_URL}/relatorios/servos-missa?data_inicio=${start}&data_fim=${end}&pastorais=${pastorais}`;
            const res = await this.authFetch(url);
            if (!res.ok) throw new Error('Falha ao gerar relatório');

            const data = await res.json();

            let html = `
                <div class="report-header">
                    <h1>Escala de Servos por Missa</h1>
                    <p>Período: ${new Date(start + 'T00:00').toLocaleDateString('pt-BR')} a ${new Date(end + 'T00:00').toLocaleDateString('pt-BR')}</p>
                    <p>Emitido em: ${new Date().toLocaleString('pt-BR')}</p>
                </div>
            `;

            if (data.length === 0) {
                html += '<p style="text-align:center; padding: 3rem; color: var(--text-muted);">Nenhuma missa com escala encontrada no período selecionado.</p>';
            } else {
                data.forEach(m => {
                    const dataFmt = new Date(m.data_missa + 'T00:00').toLocaleDateString('pt-BR');
                    html += `
                        <div class="report-section">
                            <div class="report-mass-header">
                                <span>Missa: ${dataFmt} - ${m.hora}</span>
                                <span>Celebrante: ${m.celebrante || '—'}</span>
                                <span>Local: ${m.comunidade || '—'}</span>
                            </div>
                    `;

                    m.pastorais.forEach(p => {
                        html += `
                            <div class="report-pastoral-group">
                                <div class="report-pastoral-title">${p.pastoral_nome} (${p.quantidade} vagas)</div>
                                <div class="report-servos-list">
                        `;

                        p.servos.forEach(s => {
                            const isVago = s === '(vago)';
                            html += `<div class="report-servo-item ${isVago ? 'vago' : ''}">${isVago ? '(vago)' : s}</div>`;
                        });

                        html += `</div></div>`;
                    });

                    html += `</div>`;
                });
            }

            container.innerHTML = html;
        } catch (err) {
            container.innerHTML = `<p style="color:var(--error-color); text-align:center; padding: 2rem;">Erro ao carregar relatório: ${err.message}</p>`;
        }
    },

    setupConfiguracoes() {
        const form = document.getElementById('form-configuracoes');
        if (!form) return;

        // Pre-fill
        const configs = this.state.configs || {};
        document.getElementById('cfg-paroquia-nome').value = configs.paroquia_nome || '';
        document.getElementById('cfg-paroquia-logo').value = configs.paroquia_logo || '';

        const newForm = form.cloneNode(true);
        form.parentNode.replaceChild(newForm, form);

        newForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const nome = document.getElementById('cfg-paroquia-nome').value;
            const logo = document.getElementById('cfg-paroquia-logo').value;

            const btn = newForm.querySelector('button[type="submit"]');
            const originalHtml = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="ph ph-circle-notch ph-spin"></i> Salvando...';

            try {
                const res = await app.authFetch(`${API_URL}/configuracoes`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        paroquia_nome: nome,
                        paroquia_logo: logo
                    })
                });

                if (res.ok) {
                    this.showToast('Configurações salvas!');
                    await this.loadConfigs();
                } else {
                    const errorData = await res.json();
                    this.showToast(`Erro: ${errorData.error || 'Falha ao salvar'}`, 'error');
                }
            } catch (err) {
                this.showToast('Erro de conexão', 'error');
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalHtml;
            }
        });
    },

    async abrirModalCalculaOfertas() {
        document.getElementById('modal-calcula-ofertas').style.display = 'flex';

        const tbodyMoedas = document.getElementById('tb-calcula-moedas');
        const tbodyNotas = document.getElementById('tb-calcula-notas');
        tbodyMoedas.innerHTML = '';
        tbodyNotas.innerHTML = '';

        const moedas = [0.01, 0.05, 0.10, 0.25, 0.50, 1.00];
        const notas = [2.00, 5.00, 10.00, 20.00, 50.00, 100.00, 200.00];

        const adicionarLinha = (valor, icone, tbody) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><i class="ph ${icone}" style="color:var(--primary-color); padding-right: 0.2rem;"></i> R$ ${valor.toFixed(2).replace('.', ',')}</td>
                <td style="text-align:center;"><input type="number" min="0" class="input-qtde" data-valor="${valor}" oninput="app.recalcularTotalOfertas()"></td>
                <td class="linha-total">R$ 0,00</td>
            `;
            tbody.appendChild(tr);
        };

        moedas.forEach(v => adicionarLinha(v, 'ph-coin', tbodyMoedas));
        notas.forEach(v => adicionarLinha(v, 'ph-money', tbodyNotas));

        this.recalcularTotalOfertas();

        const configs = this.state.configs || {};
        const printHeader = document.getElementById('print-ofertas-paroquia');
        if (printHeader) {
            printHeader.textContent = configs.paroquia_nome || 'Paróquia';
        }

        // Sincronizar Missas do Dashboard para o Modal
        const selectDash = document.getElementById('filtro-missa-dashboard');
        const selectModal = document.getElementById('oferta-missa-select');
        if (selectDash && selectModal) {
            // Limpar e copiar opções
            selectModal.innerHTML = '';
            Array.from(selectDash.options).forEach(opt => {
                const newOpt = document.createElement('option');
                newOpt.value = opt.value;
                newOpt.textContent = opt.textContent;
                selectModal.appendChild(newOpt);
            });
            // Definir o selecionado igual ao dashboard
            selectModal.value = selectDash.value;
        }
    },

    recalcularTotalOfertas() {
        const inputs = document.querySelectorAll('#print-ofertas-area .input-qtde');
        let totalGeral = 0;

        inputs.forEach(input => {
            const valor = parseFloat(input.getAttribute('data-valor'));
            const qtde = parseInt(input.value) || 0;
            const totalLinha = valor * qtde;
            totalGeral += totalLinha;

            const tr = input.closest('tr');
            tr.querySelector('.linha-total').textContent = `R$ ${totalLinha.toFixed(2).replace('.', ',')}`;
        });

        document.getElementById('total-geral-ofertas').textContent = `R$ ${totalGeral.toFixed(2).replace('.', ',')}`;
        // Armazenar o valor numérico para facilitar a gravação
        this.state.ultimoTotalOfertas = totalGeral;
    },

    async gravarOfertas() {
        if (!this.state.ultimoTotalOfertas || this.state.ultimoTotalOfertas <= 0) {
            this.showToast('O valor total deve ser maior que zero.', 'error');
            return;
        }

        const idMissa = document.getElementById('oferta-missa-select').value;
        if (!idMissa) {
            this.showToast('Por favor, selecione a missa desejada.', 'error');
            return;
        }

        const btn = document.getElementById('btn-gravar-oferta');
        const originalHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="ph ph-circle-notch animate-spin"></i> Gravando...';

        try {
            // 1. Buscar ID do Dizimista Especial "Imaculado Coração de Maria"
            const resDiz = await this.authFetch(`${API_URL}/dizimistas?q=Imaculado Coração de Maria&per_page=1`);
            const dataDiz = await resDiz.json();
            const dizimista = (dataDiz.data || []).find(d => d.nome.includes('Imaculado'));

            if (!dizimista) {
                throw new Error('Dizimista "Imaculado Coração de Maria" não encontrado no sistema.');
            }

            // 2. Buscar ID do Tipo de Lançamento "Oferta"
            const resTL = await this.authFetch(`${API_URL}/tipos-lancamentos`);
            const dataTL = await resTL.json();
            const tipoLanc = dataTL.find(t => t.descricao.toLowerCase().includes('oferta'));

            // 3. Buscar ID do Tipo de Pagamento "Dinheiro"
            const resTP = await this.authFetch(`${API_URL}/tipos-pagamento`);
            const dataTP = await resTP.json();
            const tipoPag = dataTP.find(t => t.descricao.toLowerCase().includes('dinheiro'));

            // 4. Preparar dados da transação
            const now = new Date();
            const competencia = `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

            const payload = {
                id_dizimista: dizimista.id_dizimista,
                valor: this.state.ultimoTotalOfertas,
                competencia: competencia,
                id_tipo_pagamento: tipoPag ? tipoPag.id_tipo_pagamento : 1, // Fallback p/ 1 se não achar
                id_tipo_lancamento: tipoLanc ? tipoLanc.id_tipo_lancamento : null,
                id_missa: idMissa,
                id_usuario: this.state.user.id_usuario,
                observacao: 'Lançamento automático via Calculadora de Ofertas'
            };

            const resPost = await this.authFetch(`${API_URL}/recebimentos`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (resPost.ok) {
                this.showToast('Oferta gravada com sucesso!');
                document.getElementById('modal-calcula-ofertas').style.display = 'none';
                this.loadDashboard(idMissa); // Atualiza o dashboard para mostrar o novo lançamento
            } else {
                await this.handleResponseError(resPost, 'Erro ao gravar oferta');
            }
        } catch (err) {
            this.showToast(err.message || 'Erro de conexão ao gravar oferta', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    },

    imprimirCalculaOfertas() {
        document.body.classList.add('print-calcula-ofertas');

        // Garantir tamanho A4 para ofertas
        const style = document.createElement('style');
        style.id = 'print-page-style';
        style.innerHTML = '@page { size: A4; margin: 15mm; }';
        document.head.appendChild(style);

        window.print();

        document.body.classList.remove('print-calcula-ofertas');
        const dynamicStyle = document.getElementById('print-page-style');
        if (dynamicStyle) dynamicStyle.remove();
    },

    abrirChatbot() {
        // Agora usamos a rota configurada no Nginx em vez da porta 3000
        // Essa linha foi alterada pelo bot
        const token = 'Alinne05@token';
        const url = `/chatbot/?token=${token}`;
        window.open(url, '_blank');
    }
};

document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
