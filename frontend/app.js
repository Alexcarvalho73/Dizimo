// Em produção (Render), usa o mesmo domínio da página. Local usa localhost:5000
const API_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:5000/api'
    : '/api';

const app = {
    state: {
        user: null,
        currentView: '',
        token: null
    },

    init() {
        this.container = document.getElementById('app-container');
        
        // Restore session
        const savedUser = localStorage.getItem('dizimo_user');
        if (savedUser) {
            this.state.user = JSON.parse(savedUser);
            this.renderMain();
            this.navTo('dashboard');
        } else {
            this.renderLogin();
        }
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
                const res = await fetch(`${API_URL}/auth/login`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({login: u, senha: p})
                });
                const data = await res.json();
                
                if (res.ok) {
                    this.state.user = data.user;
                    localStorage.setItem('dizimo_user', JSON.stringify(data.user));
                    this.renderMain();
                    this.navTo('dashboard');
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
        
        // Hide/show restricted menus
        if (this.state.user.permissoes) {
            if (this.state.user.permissoes.includes('Visualizar Usuários')) document.getElementById('nav-usuarios').style.display = 'flex';
            if (this.state.user.permissoes.includes('Gerenciar Perfis')) document.getElementById('nav-perfis').style.display = 'flex';
        }
        
        // Setup nav links
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.currentTarget.getAttribute('data-target');
                if (target === 'logout') {
                    this.logout();
                } else {
                    this.navTo(target);
                }
            });
        });
    },

    logout() {
        this.state.user = null;
        localStorage.removeItem('dizimo_user');
        this.renderLogin();
    },

    // Navigation Subsystem
    navTo(viewId) {
        this.state.currentView = viewId;
        const contentArea = document.getElementById('content-area');
        const tpl = document.getElementById(`view-${viewId}`);
        
        if (!tpl) return;
        
        contentArea.innerHTML = '';
        contentArea.appendChild(tpl.content.cloneNode(true));
        
        // Update active state in sidebar
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.classList.remove('active');
            if(btn.getAttribute('data-target') === viewId) btn.classList.add('active');
        });

        // Initialize view logic
        this.initView(viewId);
    },

    initView(viewId) {
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
            'perfil-form': 'Cadastro de Perfil'
        };
        const titleEl = document.getElementById('page-title');
        if (titleEl && titles[viewId]) titleEl.textContent = titles[viewId];

        /* Run logic based on view */
        if (viewId === 'dashboard') this.loadDashboard();
        if (viewId === 'dizimistas') this.loadDizimistas();
        if (viewId === 'novo-dizimista') this.setupNovoDizimista();
        if (viewId === 'recebimentos') this.loadRecebimentosList();
        if (viewId === 'lancar-recebimento') this.setupLancarRecebimento();
        if (viewId === 'missas') this.loadMissas();
        if (viewId === 'missa-form') this.setupMissaForm();
        if (viewId === 'usuarios') this.loadUsuarios();
        if (viewId === 'usuario-form') this.setupUsuarioForm();
        if (viewId === 'perfis') this.loadPerfis();
        if (viewId === 'perfil-form') this.setupPerfilForm();
    },

    // --- View Implementations ---

    async loadDashboard() {
        try {
            const res = await fetch(`${API_URL}/dashboard`);
            if(res.ok) {
                const data = await res.json();
                document.getElementById('stat-dia').textContent = `R$ ${data.total_dia.toFixed(2)}`;
                document.getElementById('stat-mes').textContent = `R$ ${data.total_mes.toFixed(2)}`;
                document.getElementById('stat-ativos').textContent = data.dizimistas_ativos;
            }

            // Load recent list
            const recRes = await fetch(`${API_URL}/recebimentos`);
            if (recRes.ok) {
                const recs = await recRes.json();
                const tbody = document.getElementById('tb-recent');
                tbody.innerHTML = '';
                recs.slice(0, 5).forEach(r => { // Show top 5
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td>${new Date(r.data_recebimento).toLocaleDateString('pt-BR')}</td>
                        <td><strong>${r.dizimista_nome}</strong></td>
                        <td>${r.competencia}</td>
                        <td style="color:var(--success-color); font-weight:bold;">R$ ${r.valor.toFixed(2)}</td>
                    `;
                    tbody.appendChild(tr);
                });
            }
        } catch (e) {
            console.error("Dashboard error", e);
        }
    },

    async loadDizimistas(q = '', fonetica = '') {
        try {
            let url = `${API_URL}/dizimistas`;
            if (fonetica) {
                url += `?fonetica=${encodeURIComponent(fonetica)}`;
            } else if (q) {
                url += `?q=${encodeURIComponent(q)}`;
            }
            const res = await fetch(url);
            if (res.ok) {
                const dizimistas = await res.json();
                const tbody = document.getElementById('tb-dizimistas');
                if (!tbody) return;
                tbody.innerHTML = '';
                dizimistas.forEach(d => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td><strong>${d.nome}</strong></td>
                        <td>${d.cpf || '-'}</td>
                        <td>${d.telefone || '-'}</td>
                        <td><span class="badge ${d.status === 1 ? 'badge-success' : 'badge-danger'}">${d.status === 1 ? 'Ativo' : 'Inativo'}</span></td>
                        <td>
                            <button class="btn-icon btn-hist-diz" data-id="${d.id_dizimista}" data-nome="${d.nome}" title="Ver Histórico"><i class="ph ph-file-text"></i></button>
                            <button class="btn-icon btn-edit-diz" data-diz='${JSON.stringify(d)}' title="Editar"><i class="ph ph-pencil-simple"></i></button>
                        </td>
                    `;
                    tbody.appendChild(tr);
                });

                document.querySelectorAll('.btn-edit-diz').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        const diz = JSON.parse(e.currentTarget.getAttribute('data-diz'));
                        this.navTo('novo-dizimista');
                        setTimeout(() => this.fillDizimistaForm(diz), 100);
                    });
                });

                document.querySelectorAll('.btn-hist-diz').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        const id = e.currentTarget.getAttribute('data-id');
                        const nome = e.currentTarget.getAttribute('data-nome');
                        
                        document.getElementById('hist-nome').textContent = nome;
                        const tbodyHist = document.getElementById('tb-hist-pagamentos');
                        tbodyHist.innerHTML = '<tr><td colspan="3" style="text-align:center;">Carregando...</td></tr>';
                        document.getElementById('modal-historico').style.display = 'flex';
                        
                        try {
                            const res = await fetch(`${API_URL}/recebimentos?id_dizimista=${id}`);
                            if (res.ok) {
                                const recs = await res.json();
                                tbodyHist.innerHTML = '';
                                
                                const grouped = {};
                                recs.forEach(r => {
                                    if(!grouped[r.competencia]) grouped[r.competencia] = [];
                                    grouped[r.competencia].push(r);
                                });
                                
                                // Geração das 12 competências do ano atual
                                const currentYear = new Date().getFullYear();
                                for (let m = 1; m <= 12; m++) {
                                    const compStr = `${m.toString().padStart(2, '0')}/${currentYear}`;
                                    if (!grouped[compStr]) grouped[compStr] = [];
                                }
                                
                                // Sorting por competência (decrescente)
                                const sortedComps = Object.keys(grouped).sort((a,b) => {
                                    const [mA, yA] = a.split('/');
                                    const [mB, yB] = b.split('/');
                                    const valA = parseInt(yA)*100 + parseInt(mA);
                                    const valB = parseInt(yB)*100 + parseInt(mB);
                                    return valB - valA;
                                });

                                sortedComps.forEach(comp => {
                                    const items = grouped[comp];
                                    const total = items.reduce((sum, item) => sum + item.valor, 0);
                                    const hasItems = items.length > 0;
                                    
                                    const mainTr = document.createElement('tr');
                                    mainTr.innerHTML = `
                                        <td style="text-align:center; vertical-align:middle;">
                                            ${hasItems ? `<button class="btn-icon btn-toggle-details" style="font-size:1.5rem" title="Ver Detalhes"><i class="ph ph-plus-circle"></i></button>` : `<button class="btn-icon btn-fast-pay" data-comp="${comp}" data-id="${id}" style="font-size:1.5rem; color:var(--primary-color)" title="Lançar Recebimento"><i class="ph ph-hand-coins"></i></button>`}
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
                                        
                                        let detailsHtml = `<td colspan="3" style="padding: 0; background: var(--bg-main);">
                                            <div style="padding: 1rem 1rem 1rem 3rem; border-left: 3px solid var(--primary-light);">
                                                <table style="width: 100%; font-size: 0.85rem; border-collapse: collapse;">
                                                    <thead style="color: var(--text-muted); border-bottom: 2px solid var(--border-color);">
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
                                            detailsHtml += `
                                                <tr style="border-bottom: 1px solid rgba(0,0,0,0.05);">
                                                    <td style="padding:0.5rem;">${dataFmt}</td>
                                                    <td style="padding:0.5rem;">${r.competencia}</td>
                                                    <td style="padding:0.5rem;">${r.tipo_pagamento_nome || '-'}</td>
                                                    <td style="padding:0.5rem; text-align:right; font-weight:600;">R$ ${r.valor.toFixed(2).replace('.', ',')}</td>
                                                </tr>
                                            `;
                                        });
                                        detailsHtml += `</tbody></table></div></td>`;
                                        detailsTr.innerHTML = detailsHtml;
                                        tbodyHist.appendChild(detailsTr);
                                        
                                        const btnToggle = mainTr.querySelector('.btn-toggle-details');
                                        btnToggle.addEventListener('click', () => {
                                            const icon = btnToggle.querySelector('i');
                                            if (detailsTr.style.display === 'none') {
                                                detailsTr.style.display = '';
                                                icon.classList.remove('ph-plus-circle');
                                                icon.classList.add('ph-minus-circle');
                                            } else {
                                                detailsTr.style.display = 'none';
                                                icon.classList.add('ph-plus-circle');
                                                icon.classList.remove('ph-minus-circle');
                                            }
                                        });
                                    } else {
                                        const btnFastPay = mainTr.querySelector('.btn-fast-pay');
                                        if (btnFastPay) {
                                            btnFastPay.addEventListener('click', (ev) => {
                                                document.getElementById('modal-historico').style.display = 'none';
                                                app.state.prefillRecebimento = {
                                                    id_dizimista: ev.currentTarget.getAttribute('data-id'),
                                                    competencia: ev.currentTarget.getAttribute('data-comp')
                                                };
                                                app.navTo('lancar-recebimento');
                                            });
                                        }
                                    }
                                });
                            }
                        } catch(err) {
                            tbodyHist.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--error-color);">Erro ao carregar histórico.</td></tr>';
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
                            this.loadDizimistas('', foneticaInput.value);
                        } else {
                            normalWrap.style.display = 'flex';
                            foneticaWrap.style.display = 'none';
                            btnToggle.classList.remove('btn-primary');
                            btnToggle.classList.add('btn-secondary');
                            foneticaInput.value = '';
                            this.loadDizimistas(searchInput.value, '');
                        }
                    });
                    btnToggle.dataset.listenerAttached = 'true';
                }

                if (searchInput && !searchInput.dataset.listenerAttached) {
                    searchInput.addEventListener('input', (e) => {
                        this.loadDizimistas(e.target.value, '');
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
                        this.loadDizimistas('', e.target.value);
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

    setupNovoDizimista() {
        const form = document.getElementById('form-dizimista');
        const newForm = form.cloneNode(true);
        form.parentNode.replaceChild(newForm, form);

        document.getElementById('title-dizimista-form').textContent = 'Novo Dizimista';
        document.getElementById('diz-id').value = '';
        document.getElementById('diz-nome').value = '';
        document.getElementById('diz-cpf').value = '';
        document.getElementById('diz-tel').value = '';
        document.getElementById('diz-email').value = '';
        document.getElementById('diz-endereco').value = '';
        document.getElementById('diz-bairro').value = '';
        document.getElementById('diz-cidade').value = '';
        document.getElementById('diz-cep').value = '';
        document.getElementById('diz-observacoes').value = '';

        const cpfInput = document.getElementById('diz-cpf');
        cpfInput.addEventListener('input', (e) => {
            let val = e.target.value.replace(/\D/g, ''); 
            if (val.length > 11) val = val.slice(0, 11);
            
            if (val.length > 9) {
                val = val.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
            } else if (val.length > 6) {
                val = val.replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3');
            } else if (val.length > 3) {
                val = val.replace(/(\d{3})(\d{1,3})/, '$1.$2');
            }
            e.target.value = val;
        });

        newForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('diz-id').value;
            const data = {
                nome: document.getElementById('diz-nome').value,
                cpf: document.getElementById('diz-cpf').value,
                telefone: document.getElementById('diz-tel').value,
                email: document.getElementById('diz-email').value,
                endereco: document.getElementById('diz-endereco').value,
                bairro: document.getElementById('diz-bairro').value,
                cidade: document.getElementById('diz-cidade').value,
                cep: document.getElementById('diz-cep').value,
                observacoes: document.getElementById('diz-observacoes').value,
                user_id: this.state.user.id_usuario
            };

            const method = id ? 'PUT' : 'POST';
            const url = id ? `${API_URL}/dizimistas/${id}` : `${API_URL}/dizimistas`;

            try {
                const res = await fetch(url, {
                    method: method,
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(data)
                });
                if(res.ok) {
                    this.showToast(id ? 'Dizimista atualizado com sucesso!' : 'Dizimista cadastrado com sucesso!');
                    this.navTo('dizimistas');
                } else {
                    const err = await res.json();
                    this.showToast(err.error || 'Erro ao salvar', 'error');
                }
            } catch (error) {
                this.showToast('Erro de conexão', 'error');
            }
        });
    },

    fillDizimistaForm(d) {
        document.getElementById('title-dizimista-form').textContent = 'Editar Dizimista';
        document.getElementById('diz-id').value = d.id_dizimista;
        document.getElementById('diz-nome').value = d.nome || '';
        document.getElementById('diz-cpf').value = d.cpf || '';
        document.getElementById('diz-tel').value = d.telefone || '';
        document.getElementById('diz-email').value = d.email || '';
        document.getElementById('diz-endereco').value = d.endereco || '';
        document.getElementById('diz-bairro').value = d.bairro || '';
        document.getElementById('diz-cidade').value = d.cidade || '';
        document.getElementById('diz-cep').value = d.cep || '';
        document.getElementById('diz-observacoes').value = d.observacoes || '';
    },

    async setupLancarRecebimento() {
        // Load Dizimistas selector
        try {
            const dRes = await fetch(`${API_URL}/dizimistas`);
            if(dRes.ok) {
                const dizSelect = document.getElementById('rec-dizimista');
                const list = await dRes.json();
                list.forEach(d => {
                    const opt = document.createElement('option');
                    opt.value = d.id_dizimista;
                    opt.textContent = `${d.nome} (${d.cpf})`;
                    dizSelect.appendChild(opt);
                });
            }

            const tRes = await fetch(`${API_URL}/tipos-pagamento`);
            if(tRes.ok) {
                const tSelect = document.getElementById('rec-tipo');
                const list = await tRes.json();
                list.forEach(t => {
                    const opt = document.createElement('option');
                    opt.value = t.id_tipo_pagamento;
                    opt.textContent = t.descricao;
                    tSelect.appendChild(opt);
                });
            }
        } catch (e) {
            console.error("Error loading selects", e);
        }

        if (this.state.prefillRecebimento) {
            document.getElementById('rec-dizimista').value = this.state.prefillRecebimento.id_dizimista;
            document.getElementById('rec-comp').value = this.state.prefillRecebimento.competencia;
            this.state.prefillRecebimento = null;
        }

        document.getElementById('form-recebimento').addEventListener('submit', async (e) => {
            e.preventDefault();
            const data = {
                id_dizimista: document.getElementById('rec-dizimista').value,
                valor: parseFloat(document.getElementById('rec-valor').value),
                competencia: document.getElementById('rec-comp').value,
                id_tipo_pagamento: document.getElementById('rec-tipo').value,
                id_usuario: this.state.user.id_usuario
            };

            try {
                const res = await fetch(`${API_URL}/recebimentos`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(data)
                });
                if(res.ok) {
                    this.showToast('Recebimento registrado!');
                    this.navTo('dashboard');
                } else {
                    this.showToast('Erro ao lançar pagamento', 'error');
                }
            } catch (error) {
                this.showToast('Erro de conexão', 'error');
            }
        });
    },

    async loadUsuarios() {
        try {
            const res = await fetch(`${API_URL}/usuarios`);
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
                        if(confirm('Deseja inativar este usuário?')) {
                            const id = e.currentTarget.getAttribute('data-id');
                            await fetch(`${API_URL}/usuarios/${id}`, { method: 'DELETE' });
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
            const res = await fetch(`${API_URL}/perfis`);
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
                        if(confirm('Deseja excluir este perfil?')) {
                            const id = e.currentTarget.getAttribute('data-id');
                            const delRes = await fetch(`${API_URL}/perfis/${id}`, { method: 'DELETE' });
                            if(delRes.ok) {
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

    async setupUsuarioForm() {
        document.getElementById('title-usuario-form').textContent = 'Novo Usuário';
        document.getElementById('usr-id').value = '';
        document.getElementById('usr-nome').value = '';
        document.getElementById('usr-login').value = '';
        document.getElementById('usr-senha').value = '';
        document.getElementById('usr-senha').required = true;
        
        try {
            const res = await fetch(`${API_URL}/perfis`);
            if(res.ok) {
                const select = document.getElementById('usr-perfil');
                select.innerHTML = '<option value="">Selecione...</option>';
                const perfis = await res.json();
                perfis.forEach(p => {
                    select.innerHTML += `<option value="${p.id_perfil}">${p.descricao}</option>`;
                });
            }
        } catch(e) {}

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
                current_user_id: this.state.user.login
            };

            const method = id ? 'PUT' : 'POST';
            const url = id ? `${API_URL}/usuarios/${id}` : `${API_URL}/usuarios`;

            try {
                const res = await fetch(url, {
                    method: method,
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(data)
                });
                if(res.ok) {
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
    },

    fillUsuarioForm(u) {
        document.getElementById('title-usuario-form').textContent = 'Editar Usuário';
        document.getElementById('usr-id').value = u.id_usuario;
        document.getElementById('usr-nome').value = u.nome;
        document.getElementById('usr-login').value = u.login;
        
        // Verifica existencia do perfil ciclicamente (robusto contra lentidão da nuvem)
        const setProfile = () => {
            const select = document.getElementById('usr-perfil');
            if(select && select.options.length > 1) {
                select.value = u.id_perfil;
            } else {
                setTimeout(setProfile, 50);
            }
        };
        setProfile();
        document.getElementById('usr-senha').required = false; 
    },

    async setupPerfilForm() {
        document.getElementById('title-perfil-form').textContent = 'Novo Perfil';
        document.getElementById('prf-id').value = '';
        document.getElementById('prf-descricao').value = '';
        const container = document.getElementById('permissions-container');
        container.innerHTML = '';
        
        try {
            const res = await fetch(`${API_URL}/permissoes`);
            if(res.ok) {
                const permissoes = await res.json();
                permissoes.forEach(p => {
                    container.innerHTML += `
                        <div class="permission-item">
                            <input type="checkbox" id="perm-${p.id_permissao}" value="${p.id_permissao}">
                            <label for="perm-${p.id_permissao}">${p.descricao}</label>
                        </div>
                    `;
                });
            }
        } catch(e) {}

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
                const res = await fetch(url, {
                    method: method,
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({descricao: desc})
                });
                
                if(res.ok) {
                    const savedPerfil = await res.json();
                    const targetId = id || savedPerfil.id;
                    
                    const checkedPerms = Array.from(document.querySelectorAll('.permission-item input:checked')).map(cb => cb.value);
                    await fetch(`${API_URL}/perfis/${targetId}/permissoes`, {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({permissoes: checkedPerms})
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
            const res = await fetch(`${API_URL}/perfis/${p.id_perfil}/permissoes`);
            if(res.ok) {
                const checkedIds = await res.json();
                const setPerms = () => {
                    const checkboxes = document.querySelectorAll('.permission-item input');
                    if(checkboxes.length > 0) {
                        checkedIds.forEach(id => {
                            const cb = document.getElementById(`perm-${id}`);
                            if(cb) cb.checked = true;
                        });
                    } else {
                        setTimeout(setPerms, 50);
                    }
                };
                setPerms();
            }
        } catch(e) {}
    },

    // UI Helpers
    showToast(msg, type='success') {
        const container = document.getElementById('toast-container');
        const t = document.createElement('div');
        t.className = `toast ${type}`;
        t.innerHTML = `<i class="ph ph-${type === 'success' ? 'check-circle' : 'warning-circle'}"></i> <span>${msg}</span>`;
        container.appendChild(t);
        setTimeout(() => t.remove(), 3000);
    },

    async loadRecebimentosList(mes = '', ano = '', dizimista_id = '') {
        try {
            let url = `${API_URL}/recebimentos`;
            const params = [];
            if (mes) params.push(`mes=${mes}`);
            if (ano) params.push(`ano=${ano}`);
            if (dizimista_id) params.push(`id_dizimista=${dizimista_id}`);
            if (params.length) url += '?' + params.join('&');

            const selectFiltroDiz = document.getElementById('filtro-dizimista');
            if (selectFiltroDiz && selectFiltroDiz.options.length <= 1) {
                const dRes = await fetch(`${API_URL}/dizimistas`);
                if(dRes.ok) {
                    const list = await dRes.json();
                    list.forEach(d => {
                        const opt = document.createElement('option');
                        opt.value = d.id_dizimista;
                        opt.textContent = `${d.nome} (${d.cpf || '-'})`;
                        selectFiltroDiz.appendChild(opt);
                    });
                }
            }

            const res = await fetch(url);
            if (!res.ok) return;
            const recs = await res.json();

            const tbody = document.getElementById('tb-recebimentos');
            const totalBar = document.getElementById('rec-total-bar');
            if (!tbody) return;

            tbody.innerHTML = '';
            const total = recs.reduce((sum, r) => sum + r.valor, 0);
            totalBar.textContent = recs.length > 0
                ? `Total filtrado: R$ ${total.toFixed(2).replace('.', ',')} — ${recs.length} registro(s)`
                : '';

            recs.forEach(r => {
                const tr = document.createElement('tr');
                const dataFmt = r.data_recebimento
                    ? new Date(r.data_recebimento).toLocaleDateString('pt-BR')
                    : '-';
                tr.innerHTML = `
                    <td>${dataFmt}</td>
                    <td><strong>${r.dizimista_nome}</strong></td>
                    <td>${r.competencia}</td>
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

            document.querySelectorAll('.btn-estornar').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    if (confirm('Confirma o estorno deste lançamento?')) {
                        const id = e.currentTarget.getAttribute('data-id');
                        const res = await fetch(`${API_URL}/recebimentos/${id}`, { method: 'DELETE' });
                        if (res.ok) {
                            this.showToast('Estornado com sucesso');
                            this.loadRecebimentosList(
                                document.getElementById('filtro-mes')?.value || '',
                                document.getElementById('filtro-ano')?.value || '',
                                document.getElementById('filtro-dizimista')?.value || ''
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
                    const m = document.getElementById('filtro-mes').value;
                    const a = document.getElementById('filtro-ano').value;
                    const d = document.getElementById('filtro-dizimista') ? document.getElementById('filtro-dizimista').value : '';
                    this.loadRecebimentosList(m, a, d);
                });
                btnFiltrar.dataset.bound = 'true';
            }
            if (btnLimpar && !btnLimpar.dataset.bound) {
                btnLimpar.addEventListener('click', () => {
                    document.getElementById('filtro-mes').value = '';
                    document.getElementById('filtro-ano').value = '';
                    if (document.getElementById('filtro-dizimista')) {
                        document.getElementById('filtro-dizimista').value = '';
                    }
                    this.loadRecebimentosList();
                });
                btnLimpar.dataset.bound = 'true';
            }

        } catch (e) {
            this.showToast('Erro ao carregar lançamentos', 'error');
        }
    },

    async loadMissas() {
        try {
            const res = await fetch(`${API_URL}/missas`);
            if (!res.ok) return;
            const missas = await res.json();
            const tbody = document.getElementById('tb-missas');
            if (!tbody) return;
            tbody.innerHTML = '';

            if (missas.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">Nenhuma missa cadastrada.</td></tr>';
                return;
            }

            missas.forEach(m => {
                const tr = document.createElement('tr');
                const dataFmt = m.data ? new Date(m.data + 'T00:00:00').toLocaleDateString('pt-BR') : '-';
                tr.innerHTML = `
                    <td>${dataFmt}</td>
                    <td>${m.hora || '-'}</td>
                    <td>${m.tipo || '-'}</td>
                    <td>${m.celebrante || '-'}</td>
                    <td>${m.comunidade || '-'}</td>
                    <td>
                        <button class="btn-icon btn-edit-miss" data-missa='${JSON.stringify(m)}' title="Editar"><i class="ph ph-pencil-simple"></i></button>
                        <button class="btn-icon btn-del-miss" data-id="${m.id_missa}" title="Excluir" style="color:var(--error-color)"><i class="ph ph-trash"></i></button>
                    </td>
                `;
                tbody.appendChild(tr);
            });

            document.querySelectorAll('.btn-edit-miss').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const mis = JSON.parse(e.currentTarget.getAttribute('data-missa'));
                    this.navTo('missa-form');
                    setTimeout(() => this.fillMissaForm(mis), 100);
                });
            });

            document.querySelectorAll('.btn-del-miss').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    if (confirm('Excluir esta missa?')) {
                        const id = e.currentTarget.getAttribute('data-id');
                        await fetch(`${API_URL}/missas/${id}`, { method: 'DELETE' });
                        this.showToast('Missa excluída');
                        this.loadMissas();
                    }
                });
            });
        } catch (e) {
            this.showToast('Erro ao carregar missas', 'error');
        }
    },

    async setupMissaForm() {
        document.getElementById('title-missa-form').textContent = 'Nova Missa';
        document.getElementById('miss-id').value = '';
        document.getElementById('miss-data').value = '';
        document.getElementById('miss-hora').value = '';
        document.getElementById('miss-tipo').value = '';
        document.getElementById('miss-celebrante').value = '';
        document.getElementById('miss-comunidade').value = '';

        const form = document.getElementById('form-missa');
        const newForm = form.cloneNode(true);
        form.parentNode.replaceChild(newForm, form);

        newForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('miss-id').value;
            const payload = {
                data: document.getElementById('miss-data').value,
                hora: document.getElementById('miss-hora').value,
                tipo: document.getElementById('miss-tipo').value,
                celebrante: document.getElementById('miss-celebrante').value,
                comunidade: document.getElementById('miss-comunidade').value
            };
            const method = id ? 'PUT' : 'POST';
            const url = id ? `${API_URL}/missas/${id}` : `${API_URL}/missas`;
            try {
                const res = await fetch(url, {
                    method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (res.ok) {
                    this.showToast('Missa salva com sucesso!');
                    this.navTo('missas');
                } else {
                    this.showToast('Erro ao salvar', 'error');
                }
            } catch {
                this.showToast('Erro de conexão', 'error');
            }
        });
    },

    fillMissaForm(m) {
        document.getElementById('title-missa-form').textContent = 'Editar Missa';
        document.getElementById('miss-id').value = m.id_missa;
        document.getElementById('miss-data').value = m.data || '';
        document.getElementById('miss-hora').value = m.hora || '';
        document.getElementById('miss-tipo').value = m.tipo || '';
        document.getElementById('miss-celebrante').value = m.celebrante || '';
        document.getElementById('miss-comunidade').value = m.comunidade || '';
    }
};

document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
