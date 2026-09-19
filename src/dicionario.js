// Dicionário do juiz local (src/heuristic.js). Um termo por linha; linhas
// vazias e começando com # são ignoradas. Sintaxe:
//   palavra           casa a palavra inteira (sem acento, sem maiúscula)
//   econom*           prefixo: economia, econômico, economista...
//   problema%calculo  qualquer coisa no meio (até 3 palavras)
//   termo = 2         peso diferente do padrão (1); negativo puxa para baixo
// Os pesos são quase todos iguais de propósito: o que decide é a mensagem
// (pergunta?) e a recência do contexto, não o termo em si.

const AUSTRIACA_ANCAP = `
mises = 2
ludwig von mises = 2
rothbard = 2
murray rothbard = 2
hoppe = 2
hans hermann hoppe = 2
kinsella = 2
stephan kinsella = 2
hayek = 2
friedrich hayek = 2
menger
carl menger
bohm bawerk
bohm-bawerk
eugen von bohm
wieser
huerta de soto
jesus huerta de soto
walter block
david friedman
milton friedman
friedman
molinari
gustave de molinari
bastiat = 2
frederic bastiat
lysander spooner
spooner
benjamin tucker
josiah warren
albert jay nock
nock
franz oppenheimer
oppenheimer
ayn rand
objetivis*
lew rockwell
rockwell
tom woods
thomas woods
bob murphy
robert murphy
peter schiff
schiff
ron paul
rand paul
jeffrey tucker
lawrence reed
leonard read
lapis
eu, o lapis
henry hazlitt
hazlitt
economia numa unica licao
economia em uma licao
frank chodorov
chodorov
roderick long
michael huemer
huemer
bryan caplan
caplan
mario rizzo
israel kirzner
kirzner
ludwig lachmann
lachmann
george reisman
reisman
guido hulsmann
hulsmann
joseph salerno
salerno
peter klein
david gordon
ralph raico
raico
instituto mises = 2
mises brasil = 2
mises institute
instituto rothbard
instituto liberal
ifl
instituto de formacao de lideres
ilisp
students for liberty
estudantes pela liberdade
anarcocapital* = 2
ancap* = 2
ancapismo
anarquismo de mercado
anarquia de mercado
libertar* = 2
liberalismo classico
liberal classico
minarqu*
minarquismo
paleolibertar*
agoris*
voluntaris*
voluntarismo
mutualis*
anarco*
anarquia = 2
anarquismo
anarquista
praxeolog* = 2
acao humana = 2
human action
catalax*
catalaxia
escola austriaca = 2
austriaco
austriacos
economia austriaca
teoria austriaca
ciclo economico
ciclos economicos
teoria dos ciclos
teoria austriaca%ciclos
abct
boom e bust
boom%bust
expansao artificial
expansao de credito
expansao creditic*
credito artificial
juros artificiais
juro artificial
taxa natural de juros
juros naturais
malinvestimento*
ma alocacao
mau investimento
maus investimentos
capital mal alocado
problema%calculo = 2
calculo economico = 2
impossibilidade%calculo
impossibilidade%socialismo
debate do calculo
teoria subjetiva do valor
valor subjetivo
subjetivism*
utilidade marginal
utilidade ordinal
marginalis*
revolucao marginalista
preferencia temporal = 2
preferencia demonstrada
preferencias demonstradas
ordem espontanea
ordem expontanea
conhecimento disperso
conhecimento tacito
dispersao do conhecimento
uso do conhecimento na sociedade
mao invisivel
funcao empresarial
empreendedor*
empresarialidade
descoberta empresarial
processo de mercado
estrutura de producao
estrutura de capital
bens de capital
bens de ordem superior
bens de consumo
etapas de producao
triangulo hayekiano
teoria do capital
juros originarios
juro originario
tempo e juros
axioma da acao
axioma%acao
acao proposital
meios e fins
escassez
recursos escassos
custo de oportunidade
custos de oportunidade
efeito cantillon
cantillon
inflacao monetaria
inflacionismo
moeda fiduciaria
moeda fiat
fiat money
padrao ouro = 2
padrao-ouro
lastro
sem lastro
lastreado
reservas fracionarias = 2
reserva fracionaria
free banking
banco livre
bancos livres
sistema bancario livre
denacionalizacao do dinheiro
desestatizacao do dinheiro
competicao de moedas
moeda privada
moedas privadas
dinheiro sadio
sound money
dinheiro honesto
bitcoin = 2
btc
criptomoeda*
cripto*
satoshi
halving
ouro como dinheiro
prata como dinheiro
metais preciosos
manipulacao dos juros
manipulacao monetaria
banco central = 2
bacen
bc
copom
selic
fed
federal reserve
fomc
bce
banco central europeu
end the fed
abolir o banco central
fim do banco central
autoridade monetaria
politica monetaria
politica fiscal
politica cambial
quantitative easing
afrouxamento monetario
impressao de dinheiro
imprimir dinheiro
imprimindo dinheiro
emissao monetaria
base monetaria
agregado monetario
m1
m2
multiplicador bancario
criacao de moeda
criacao de dinheiro
dinheiro do nada
dinheiro de helicoptero
helicopter money
imposto inflacionario
principio de nao agressao = 2
principio da nao agressao = 2
nao agressao = 2
nap = 2
axioma da nao agressao
agressao
agressor
coercao = 2
coercitivo
coacao
violencia institucionalizada
monopolio da violencia
monopolio da forca
uso legitimo da forca
autopropriedade = 2
self ownership
propriedade de si
homesteading = 2
apropriacao original
primeiro ocupante
primeira apropriacao
lockeano
proviso lockeano
teoria da propriedade
direitos de propriedade = 2
direito de propriedade = 2
propriedade privada = 2
propriedade legitima
titulo de propriedade
titulos de propriedade
justa aquisicao
transferencia voluntaria
troca voluntaria
trocas voluntarias
cooperacao voluntaria
associacao voluntaria
consentimento
contrato voluntario
liberdade contratual
livre associacao
livre iniciativa
livre mercado = 2
mercado livre
laissez faire
laissez-faire
capitalismo de livre mercado
capitalismo laissez faire
capitalismo puro
verdadeiro capitalismo
capitalismo de estado
capitalismo de compadrio = 2
crony capitalism
compadrio
corporativismo
mercantilismo
protecionismo
protecionista
tarifa*
barreira comercial
barreiras comerciais
livre comercio
free trade
liberalizacao
desregulamentacao
desregulacao
regulacao
regulamentacao
regulamentar
regulador
agencia reguladora
agencias reguladoras
captura regulatoria
teoria da captura
teoria da escolha publica
escolha publica
public choice
buchanan
james buchanan
gordon tullock
tullock
rent seeking
rent-seeking
busca de renda
caca a renda
caçador de renda
lobby
lobista
lobistas
privatiza* = 2
desestatiza*
estatiza*
nacionaliza*
estatal
estatais
empresa estatal
empresas estatais
empresa publica
setor publico
setor privado
iniciativa privada
monopolio = 2
monopolios
monopolista
monopolio estatal
monopolio natural
oligopolio
cartel
cartelizacao
concorrencia = 2
livre concorrencia
competicao
competitivo
barreira de entrada
barreiras de entrada
reserva de mercado
soberania do consumidor
consumidor soberano
teoria do consumidor
sociedade sem estado = 2
sem estado
ausencia de estado
estado minimo = 2
estado necessario
governo limitado
governo minimo
menos estado
mais mercado
menos governo
tamanho do estado
estado inchado
estado grande
estado maximo
estado babá
estado paternalista
paternalismo
paternalista
estado provedor
estado de bem estar = 2
estado de bem-estar
welfare state
welfare
assistencialismo = 2
assistencialista
bolsa familia
auxilio
auxilio emergencial
renda basica
renda minima
ubi
esmola estatal
dependencia do estado
clientelismo
parasitismo
parasita
parasitas
produtores e parasitas
classe produtiva
classe parasitaria
tributacao e roubo = 2
imposto e roubo = 2
taxation is theft
roubo institucionalizado
roubo legalizado
extorsao
extorsao estatal
confisco
confiscatorio
expropriacao
desapropriacao
espoliacao
espoliacao legal
o que se ve e o que nao se ve
janela quebrada
falacia da janela quebrada
vidraca quebrada
parabola da vidraca
peticao dos fabricantes de velas
fabricantes de velas
homem de acao
secessao = 2
secessionismo
direito de secessao
descentralizacao
descentralizar
descentralizado
localismo
federalismo
autogoverno
autodeterminacao
comunidade privada
cidades privadas
cidade privada
cidades livres
free cities
prospera
charter city
zonas economicas especiais
zee
liberland
seasteading
enclave
agencia de protecao
agencias de protecao
agencia de defesa privada
defesa privada
seguranca privada
policia privada
justica privada = 2
tribunais privados
tribunal privado
arbitragem privada
arbitragem
arbitro
direito policentrico
policentrismo juridico
direito consuetudinario
common law
lei natural
direito natural = 2
jusnaturalismo
jusnaturalista
positivismo juridico
juspositivismo
legalismo
etica da liberdade = 2
ethics of liberty
etica argumentativa = 2
argumentation ethics
etica libertaria
teoria libertaria
manifesto libertario
por uma nova liberdade
for a new liberty
democracia o deus que falhou = 2
democracia%deus que falhou
democracy the god that failed
anatomia do estado = 2
anatomy of the state
o que o governo fez com o nosso dinheiro
o que o governo fez%dinheiro
a grande depressao americana
america's great depression
poder e mercado
power and market
homem economia e estado
man economy and state
socialismo de mises
teoria da moeda e do credito
o caminho da servidao = 2
caminho da servidao
road to serfdom
a constituicao da liberdade
constituicao da liberdade
direito legislacao e liberdade
lei legislacao e liberdade
a pretensao do conhecimento
arrogancia fatal
the fatal conceit
individualismo e ordem economica
uma breve historia do homem
a short history of man
o que deve ser feito
what must be done
getting libertarianism right
contra a propriedade intelectual
against intellectual property
propriedade intelectual = 2
patente
patentes
direito autoral
direitos autorais
copyright
pirataria
`;

const ECONOMIA = `
econom* = 2
macroeconom*
microeconom*
economista
economistas
ciencia economica
teoria economica
pensamento economico
historia do pensamento economico
escola de chicago
chicago
monetaris*
monetarista
keynes* = 2
keynesian*
john maynard keynes
teoria geral
multiplicador keynesiano
demanda agregada
oferta agregada
gasto publico
gastos publicos
gasto do governo
estimulo fiscal
estimulo economico
pacote de estimulo
neoclassic*
neoliberal* = 2
neoliberalismo
ordoliberal*
escola de friburgo
economia social de mercado
escola classica
adam smith = 2
riqueza das nacoes
a riqueza das nacoes
teoria dos sentimentos morais
david ricardo
ricardo
vantagem comparativa
vantagens comparativas
vantagem absoluta
malthus
malthusian*
thomas malthus
john stuart mill
stuart mill
jean baptiste say
lei de say
jevons
walras
marshall
alfred marshall
pigou
externalidade*
externalidades negativas
externalidade positiva
coase
teorema de coase
ronald coase
custo de transacao
custos de transacao
custos de transacoes
schumpeter
destruicao criativa
destruicao criadora
joseph schumpeter
samuelson
paul samuelson
krugman
paul krugman
stiglitz
piketty = 2
thomas piketty
o capital no seculo xxi
capital no seculo 21
mariana mazzucato
mazzucato
estado empreendedor
ha joon chang
ha-joon chang
chutando a escada
dani rodrik
acemoglu
por que as nacoes fracassam
why nations fail
instituicoes inclusivas
instituicoes extrativas
douglass north
nova economia institucional
economia institucional
institucionalismo
economia comportamental
kahneman
thaler
nudge
racionalidade limitada
homo economicus
agente racional
expectativas racionais
robert lucas
critica de lucas
curva de phillips
phillips
nairu
taxa natural de desemprego
desemprego natural
pleno emprego
desemprego
desempregado*
taxa de desemprego
emprego
empregos
geracao de empregos
mercado de trabalho
lei trabalhista
leis trabalhistas
clt = 2
reforma trabalhista
direitos trabalhistas
encargos trabalhistas
encargo trabalhista
custo do trabalho
custo brasil
salario minimo = 2
salario-minimo
piso salarial
salario
salarios
salario real
poder de compra
poder aquisitivo
produtividade
produtividade do trabalho
capital humano
sindicato = 2
sindicatos
sindical
sindicalismo
sindicalista
greve
greves
grevista
negociacao coletiva
acordo coletivo
convencao coletiva
imposto sindical
contribuicao sindical
terceirizacao
terceirizado
pejotizacao
informalidade
trabalho informal
mercado informal
economia informal
uberizacao
gig economy
inflacao = 2
inflacionario
inflacionaria
hiperinflacao
deflacao
deflacionario
estagflacao
desinflacao
indice de precos
ipca
igpm
igp-m
inpc
ipc
cesta basica
custo de vida
carestia
aumento de precos
alta de precos
alta dos precos
precos subindo
tudo caro
tabelamento
congelamento de precos
controle de precos = 2
preco maximo
preco minimo
preco teto
teto de preco
preco de tabela
plano cruzado
plano real
plano collor
confisco da poupanca
urv
indexacao
correcao monetaria
juros
juro
taxa de juros
taxa basica
juro real
juros reais
juro nominal
juros compostos
spread bancario
credito
crédito
emprestimo
emprestimos
financiamento
financiamentos
endividamento
endividado
divida
dividas
divida publica = 2
divida do governo
divida externa
divida interna
divida bruta
divida liquida
teto de gastos
teto dos gastos
regra fiscal
arcabouco fiscal
arcabouco
responsabilidade fiscal
lei de responsabilidade fiscal
lrf
deficit = 2
deficit fiscal
deficit publico
deficit primario
superavit
superavit primario
resultado primario
equilibrio fiscal
ajuste fiscal
austeridade
austeridade fiscal
orcamento
orcamento publico
orcamentaria
orcamentario
lei orcamentaria
ploa
ldo
ppa
emendas parlamentares
emenda parlamentar
orcamento secreto
emendas pix
gasto obrigatorio
gastos obrigatorios
despesa obrigatoria
despesas obrigatorias
despesa discricionaria
rigidez orcamentaria
vinculacao de receitas
desvinculacao
dru
contingenciamento
imposto* = 2
tribut* = 2
tributacao = 2
carga tributaria = 2
taxacao
contribuicao
contribuicoes
fisco
receita federal
arrecadacao
arrecadar
sonegacao
sonegador
elisao fiscal
evasao fiscal
planejamento tributario
paraiso fiscal
paraisos fiscais
offshore
reforma tributaria = 2
iva
ibs
cbs
imposto sobre valor agregado
imposto de renda = 2
irpf
irpj
isencao
isento
isencao do ir
faixa de isencao
tabela do ir
imposto sobre heranca
itcmd
imposto sobre grandes fortunas
igf
imposto sobre fortunas
taxar os ricos
taxar fortunas
taxacao dos ricos
super ricos
bilionarios
icms
ipi
iss
pis
cofins
csll
iof
ipva
iptu
itbi
cide
inss
previdencia = 2
previdenciario
previdenciaria
reforma da previdencia
aposentadoria
aposentado
aposentados
aposentar
regime geral
rgps
rpps
capitalizacao
regime de capitalizacao
regime de reparticao
piramide de ponzi
esquema de ponzi
ponzi
esquema piramide
bolha
bolhas
bolha imobiliaria
bolha financeira
crise de 2008
2008
subprime
lehman brothers
lehman
crise financeira
crise economica = 2
crise de 29
1929
grande depressao
depressao economica
recessao = 2
recessivo
estagnacao
estagnacao secular
crescimento economico = 2
crescimento
pib = 2
produto interno bruto
pib per capita
renda per capita
renda nacional
renda media
renda familiar
distribuicao de renda = 2
concentracao de renda
desigualdade = 2
desigualdade de renda
desigualdade social
desigualdade economica
gini
indice de gini
coeficiente de gini
pobreza
pobre
pobres
extrema pobreza
miseria
miseravel
linha da pobreza
riqueza
rico
ricos
enriquecimento
enriquecer
prosperidade
prosperar
padrao de vida
qualidade de vida
idh
desenvolvimento economico
desenvolvimento
subdesenvolvimento
pais subdesenvolvido
paises subdesenvolvidos
pais em desenvolvimento
paises emergentes
emergentes
primeiro mundo
terceiro mundo
milagre economico
milagre coreano
tigres asiaticos
coreia do sul
cingapura
singapura
hong kong
japao
china = 1
chines
economia chinesa
modelo chines
estados unidos
eua = 1
economia americana
argentina = 2
argentino
milei = 2
javier milei
motosserra
la casta
dolarizacao
dolarizar
peso argentino
venezuela = 2
venezuelano
maduro
chavez
chavismo
chavista
cuba = 2
cubano
regime cubano
embargo
coreia do norte
uniao sovietica = 2
urss
sovietico
sovietica
stalin
lenin
trotsky
gulag
holodomor
grande fome
fome na china
grande salto
revolucao cultural
mao tse tung
khmer vermelho
pol pot
alemanha oriental
muro de berlim
queda do muro
bloco sovietico
cortina de ferro
guerra fria
chile
pinochet
chicago boys
milagre chileno
nova zelandia
suica
suico
irlanda
estonia
paises nordicos
modelo nordico
suecia
noruega
dinamarca
finlandia
socialismo nordico
social democracia
social-democracia
socialdemocracia
socialdemocrata
mercado
mercados
economia de mercado
sistema de precos
mecanismo de precos
precos
preco
preco de mercado
preco justo
formacao de precos
oferta e demanda = 2
oferta e procura
lei da oferta
lei da demanda
lei da oferta e demanda
demanda
procura
elasticidade
elastico
inelastico
equilibrio de mercado
equilibrio geral
equilibrio parcial
excesso de demanda
excesso de oferta
escassez de oferta
desabastecimento
falta de produtos
prateleiras vazias
racionamento
racionar
lucro
lucros
lucrar
lucratividade
margem de lucro
lucro abusivo
lucro excessivo
lucro exorbitante
ganancia
ganancioso
capital
capitalista = 2
capitalistas
capitalismo = 2
sistema capitalista
modo de producao capitalista
acumulacao de capital
acumulacao primitiva
investimento
investimentos
investir
investidor
investidores
poupanca
poupar
poupador
poupadores
formacao de capital
taxa de poupanca
consumo
consumismo
consumista
consumidor
consumidores
demanda do consumidor
producao
produtor
produtores
produzir
produtividade
fator de producao
fatores de producao
terra trabalho e capital
capital e trabalho
patrao
patroes
empregador
empregado
empresa
empresas
empresario
empresarios
empreendedorismo
empreendedor
empreender
startup
startups
negocio
negocios
pequeno negocio
pequena empresa
microempresa
mei
simples nacional
burocracia = 2
burocrata
burocratas
burocratico
papelada
alvara
licenca
licencas
licenciamento
abrir empresa
abrir uma empresa
facilidade de fazer negocios
doing business
ambiente de negocios
inseguranca juridica
seguranca juridica
respeito aos contratos
contratos
contrato
quebra de contrato
inadimplencia
calote
falencia
falir
recuperacao judicial
comercio
comercial
comerciante
importacao
importar
importado
exportacao
exportar
exportador
balanca comercial
balanco de pagamentos
deficit comercial
superavit comercial
cambio
taxa de cambio
cambio flutuante
cambio fixo
desvalorizacao
desvalorizar
valorizacao cambial
dolar
dolares
cotacao do dolar
dolar alto
dolar subindo
euro
moeda
moedas
dinheiro
papel moeda
papel-moeda
cedula
cedulas
escambo
meio de troca
reserva de valor
unidade de conta
dinheiro mercadoria
commodity money
commodit*
petroleo
petrobras
pre sal
pre-sal
preco da gasolina
preco do combustivel
combustivel
preco da energia
conta de luz
tarifa de energia
eletrobras
mineracao
agronegocio
agro
agricultura
subsidio agricola
subsidios agricolas
produtor rural
commodities agricolas
subsidio = 2
subsidios
subsidiado
subsidiar
incentivo fiscal
incentivos fiscais
renuncia fiscal
beneficio fiscal
beneficios fiscais
isencao fiscal
desoneracao
reoneracao
lei rouanet
rouanet
bndes = 2
banco de desenvolvimento
campeoes nacionais
campeas nacionais
juros subsidiados
credito subsidiado
credito direcionado
financiamento publico
fundo publico
fundos publicos
gasto social
gastos sociais
programa social
programas sociais
politica publica
politicas publicas
politica industrial
politica de desenvolvimento
substituicao de importacoes
industrializacao
desindustrializacao
industria nacional
industria
industrial
manufatura
fabrica
fabricas
setor industrial
setor de servicos
servicos
saude publica
sus
saude privada
plano de saude
planos de saude
educacao publica
escola publica
ensino publico
universidade publica
universidade gratuita
cotas
sistema de cotas
educacao privada
escola privada
voucher
vouchers
homeschooling
ensino domiciliar
infraestrutura
obras publicas
obra publica
rodovia
rodovias
pedagio
pedagios
concessao
concessoes
ppp
parceria publico privada
parcerias publico privadas
saneamento
marco do saneamento
transporte publico
tarifa zero
passe livre
ferrovia
ferrovias
aeroporto
aeroportos
telecom*
telefonia
anatel
aneel
anp
anvisa = 2
regulacao sanitaria
vigilancia sanitaria
antitruste
lei antitruste
sherman act
concentracao de mercado
aquisicao
aquisicoes
big tech
big techs
big pharma
industria farmaceutica
farmaceutica
remedios
preco dos remedios
medicamento
medicamentos
patente de remedio
quebra de patente
mercado financeiro = 2
bolsa de valores
b3
ibovespa
acionista
acionistas
dividendo
dividendos
tributacao de dividendos
imposto sobre dividendos
renda fixa
renda variavel
tesouro direto
tesouro nacional
titulo publico
titulos publicos
titulos do tesouro
cdb
lci
lca
fundo de investimento
fundos de investimento
fundo imobiliario
fii
private equity
venture capital
capital de risco
especulacao = 2
especulador
especuladores
especulativo
especulacao financeira
financeirizacao
financista
banqueiro = 2
banqueiros
bancos
sistema bancario
sistema financeiro
lucro dos bancos
juros do cartao
cartao de credito
rotativo
cheque especial
agiota
agiotagem
usura = 2
usurario
juro abusivo
juros abusivos
juros altos
juro alto
juros baixos
juro baixo
cortar juros
subir juros
alta da selic
corte da selic
meta de inflacao
regime de metas
metas de inflacao
independencia do banco central
autonomia do banco central
autonomia do bc
campos neto
roberto campos neto
galipolo
haddad = 2
fernando haddad
ministro da fazenda
ministerio da fazenda
fazenda
guedes = 2
paulo guedes
posto ipiranga
ministerio da economia
mantega
nova matriz economica
dilma = 2
pedaladas fiscais
pedaladas
contabilidade criativa
lula = 2
governo lula
pt
governo do pt
petista
bolsonaro = 2
governo bolsonaro
fhc
fernando henrique
collor
sarney
itamar
jk
juscelino
vargas
getulio
getulio vargas
estado novo
era vargas
nacional desenvolvimentismo
desenvolvimentismo = 2
desenvolvimentista
novo desenvolvimentismo
cepal
cepalino
celso furtado
furtado
teoria da dependencia
dependentismo
centro periferia
trocas desiguais
imperialismo economico
neocolonialismo
fmi = 2
fundo monetario internacional
banco mundial
omc
organizacao mundial do comercio
gatt
ocde
g20
g7
brics
mercosul
nafta
uniao europeia
zona do euro
brexit
davos
forum economico mundial
wef
grande reset
great reset
agenda 2030
esg
capitalismo de stakeholder
stakeholder
acionista vs stakeholder
mercantiliz*
mercadoria
mercadorias
valor de uso
valor de troca
valor trabalho
teoria do valor trabalho = 2
teoria do valor-trabalho
lei do valor
mais valia = 2
mais-valia
mais valor
exploracao = 2
exploracao do trabalhador
exploracao capitalista
trabalhador explorado
trabalho explorado
trabalho alienado
alienacao
fetichismo da mercadoria
fetiche da mercadoria
reificacao
luta de classes = 2
classe trabalhadora
classe operaria
proletariado = 2
proletario
proletarios
burguesia = 2
burgues
burgueses
pequena burguesia
pequeno burgues
lumpen
lumpemproletariado
aristocracia operaria
exercito industrial de reserva
exercito de reserva
pauperizacao
pauperismo
queda tendencial
taxa de lucro
tendencia de queda da taxa de lucro
composicao organica do capital
capital constante
capital variavel
capital fixo
capital circulante
reproducao ampliada
acumulacao
crise de superproducao
superproducao
subconsumo
crise ciclica
crises ciclicas
contradicoes do capitalismo
contradicao do capital
mercadorias fictic*
capital ficticio
`;

const POLITICA = `
politic* = 2
politico
politicos
politicagem
politiqueiro
partid*
partido politico
partidos politicos
eleicao
eleicoes
eleitoral
eleitor
eleitores
eleitorado
voto
votos
votar
votacao
urna
urnas
urna eletronica
fraude eleitoral
fraude nas urnas
tse
tre
justica eleitoral
campanha eleitoral
campanha
candidato
candidatos
candidatura
candidatar
coligacao
coligacoes
federacao partidaria
fundo partidario = 2
fundo eleitoral = 2
fundao
dinheiro publico para partidos
financiamento de campanha
financiamento publico de campanha
caixa dois
caixa 2
propina
propinas
corrupcao = 2
corrupto
corruptos
corromper
corruptor
mensalao
petrolao
lava jato = 2
lava-jato
operacao lava jato
sergio moro
dallagnol
deltan
odebrecht
jbs
delacao
delacao premiada
delator
prisao em segunda instancia
segunda instancia
foro privilegiado
foro especial
impunidade
impune
rachadinha
nepotismo
patrimonialismo
patrimonialista
fisiologismo
fisiologico
centrao = 2
toma la da ca
loteamento
loteamento de cargos
cargo comissionado
cargos comissionados
cargo de confianca
apadrinhado
apadrinhamento
indicacao politica
indicacao politica
governo
governos
governar
governante
governantes
governador
governadores
prefeito
prefeitos
prefeitura
vereador
vereadores
camara municipal
deputado = 2
deputados
deputado federal
deputado estadual
senador = 2
senadores
senado
camara dos deputados
camara
congresso = 2
congressista
congressistas
parlamento
parlamentar
parlamentares
legislativo
poder legislativo
executivo
poder executivo
judiciario = 2
poder judiciario
tres poderes
separacao dos poderes
separacao de poderes
harmonia entre os poderes
freios e contrapesos
checks and balances
presidente
presidencia
presidencial
presidencialismo
parlamentarismo
semipresidencialismo
monarquia = 2
monarquista
monarquico
realeza
imperio
imperador
imperial
imperio do brasil
dom pedro
dom pedro ii
proclamacao da republica
republica = 2
republicano
republicanismo
republica velha
coronelismo
voto de cabresto
democracia = 2
democratico
democrata
democratas
democracia direta
democracia representativa
democracia liberal
democracia iliberal
democracia participativa
plebiscito
referendo
consulta popular
tirania da maioria
ditadura da maioria
regra da maioria
maioria
minoria
minorias
vontade geral
vontade do povo
vontade popular
soberania popular
soberania = 2
soberano
soberania nacional
estado nacional
estado-nacao
nacao
nacoes
nacional
nacionalismo = 2
nacionalista
patriotismo
patriota
patriotas
ufanismo
globalismo = 2
globalista
globalistas
globalizacao
antiglobalizacao
nova ordem mundial
governo mundial
onu = 2
nacoes unidas
oms
organizacao mundial da saude
unesco
otan
nato
elite
elites
elite global
establishment
deep state
estado profundo
sistema
oligarquia
oligarca
oligarcas
plutocracia
plutocrata
tecnocracia
tecnocrata
tecnocratas
burocracia estatal
maquina publica
maquina estatal
aparelho estatal
aparelho do estado
aparelhamento
aparelhado
aparelhar
funcionario publico = 2
funcionarios publicos
servidor publico = 2
servidores publicos
funcionalismo
funcionalismo publico
concurso publico
concursado
estabilidade
estabilidade do servidor
reforma administrativa
supersalario
supersalarios
penduricalho
penduricalhos
auxilio moradia
auxilio paletó
teto remuneratorio
teto constitucional
privilegio = 2
privilegios
privilegiado
privilegiados
casta politica
classe politica
regalias
mordomias
estado
estatismo = 2
estatista = 2
estatistas
estadolatra
estadolatria
intervencao = 2
intervencionismo = 2
intervencionista
intervencao estatal
intervencao do estado
intervencao do governo
intervencao na economia
mao pesada do estado
mao do estado
governo forte
governo fraco
autoritarismo = 2
autoritario
autoritaria
totalitarismo = 2
totalitario
totalitaria
ditadura = 2
ditador
ditadores
ditatorial
regime militar
ditadura militar
golpe militar
golpe de 64
1964
golpe de estado
golpe
golpista
golpismo
ai-5
ai5
tortura
torturador
anistia
lei da anistia
comissao da verdade
redemocratizacao
diretas ja
constituinte
constituicao = 2
constitucional
constitucionalidade
inconstitucional
inconstitucionalidade
constituicao de 88
constituicao de 1988
constituicao cidada
carta magna
emenda constitucional
pec
clausula petrea
clausulas petreas
stf = 2
supremo
supremo tribunal
supremo tribunal federal
ministro do stf
ministros do stf
moraes = 2
alexandre de moraes
xandao
barroso
gilmar
gilmar mendes
toffoli
fux
fachin
carmen lucia
zanin
dino
flavio dino
nunes marques
mendonca
andre mendonca
stj
tst
tcu
tribunal de contas
tribunal superior
suprema corte
ativismo judicial = 2
ativismo
judicializacao
judicializacao da politica
politizacao da justica
legislar
legislador
legislacao
lei
leis
projeto de lei
pl
pl das fake news
pl 2630
medida provisoria
mp
decreto
decretos
portaria
regime de urgencia
tramitacao
aprovacao
aprovado
vetar
veto
vetado
sancao
sancionar
sancionado
promulgar
promulgado
inquerito
inquerito das fake news
inquerito do fim do mundo
fake news = 2
desinformacao
censura = 2
censurar
censurado
liberdade de expressao = 2
liberdade de imprensa
liberdade de opiniao
liberdade de pensamento
livre expressao
free speech
discurso de odio
hate speech
cancelamento
cancelado
cultura do cancelamento
lacracao
lacrador
lacradores
lacrar
politicamente correto = 2
politicamente incorreto
woke = 2
wokismo
wokista
identitarismo = 2
identitario
identitarios
pauta identitaria
pautas identitarias
esquerda = 2
esquerdista = 2
esquerdistas
esquerdopata
esquerdismo
extrema esquerda
extrema-esquerda
ultraesquerda
direita = 2
direitista = 2
direitistas
extrema direita
extrema-direita
ultradireita
nova direita
direita liberal
direita conservadora
alt right
alt-right
centrista
centro direita
centro-direita
centro esquerda
centro-esquerda
isentao
isentoes
espectro politico
polarizacao = 2
polarizado
polarizada
radicalismo
radical
radicais
extremismo
extremista
extremistas
moderado
moderados
conservador = 2
conservadores
conservadorismo = 2
conservantismo
burke
edmund burke
reflexoes sobre a revolucao
roger scruton = 2
scruton
russell kirk
kirk
olavo = 2
olavo de carvalho
olavista
olavismo
o imbecil coletivo
o jardim das aflicoes
reacionario = 2
reacionarios
reacionarismo
tradicionalis*
tradicao
tradicional
tradicoes
valores tradicionais
valores familiares
familia tradicional
progressismo = 2
progressista = 2
progressistas
progressivo
progresso
iluminismo
iluminista
modernidade
modernismo
pos modernidade
pos-modernidade
pos modernismo
pos-moderno
posmoderno
liberalismo = 2
liberal = 2
liberais
liberalismo social
liberalismo economico
liberalismo politico
liberal progressista
libertario = 2
libertarios
libertarianismo = 2
socialismo = 2
socialista = 2
socialistas
socialismo democratico
socialismo real
socialismo cientifico
socialismo utopico
socialismo do seculo 21
socialismo do seculo xxi
comunismo = 2
comunista = 2
comunistas
comuna
comunas
comunistoide
marxismo = 2
marxista = 2
marxistas
marx = 2
karl marx
engels
friedrich engels
das kapital
manifesto comunista
manifesto do partido comunista
ideologia alema
materialismo historico
materialismo dialetico
dialetica
dialetico
gramsci = 2
gramscismo
gramscista
hegemonia
hegemonia cultural
guerra cultural
batalha cultural
marxismo cultural = 2
escola de frankfurt = 2
frankfurt
adorno
horkheimer
marcuse
habermas
teoria critica
foucault
derrida
deleuze
zizek
badiou
althusser
lukacs
lenin
leninismo
leninista
marxismo leninismo
marxismo-leninismo
stalinismo
stalinista
trotskismo
trotskista
maoismo
maoista
castrismo
castrista
bolivarianismo
bolivariano
foro de sao paulo = 2
foro de sp
socialismo bolivariano
revolucao = 2
revolucionario
revolucionaria
revolucao russa
revolucao bolchevique
bolchevique
bolcheviques
menchevique
revolucao francesa
jacobino
jacobinos
robespierre
guilhotina
revolucao cubana
revolucao chinesa
revolucao permanente
revolucao proletaria
insurreicao
guerrilha
guerrilheiro
luta armada
terrorismo
terrorista
ideologia = 2
ideologico
ideologica
ideologias
ideologizacao
doutrinacao = 2
doutrinacao ideologica
doutrinacao nas escolas
escola sem partido
lavagem cerebral
propaganda
propaganda politica
propaganda ideologica
narrativa
narrativas
militancia
militante
militantes
militar
ativismo politico
ativista
ativistas
movimento social
movimentos sociais
mst = 2
sem terra
invasao de terra
invasao de terras
reforma agraria = 2
mtst
ocupacao
ocupacoes
manifestacao
manifestacoes
protesto
protestos
passeata
8 de janeiro
oito de janeiro
atos golpistas
invasao do congresso
acampamento
quartel
intervencao militar
forcas armadas
exercito
militares
general
generais
comandante
guerra
guerras
guerra civil
guerra mundial
segunda guerra
primeira guerra
guerra da ucrania
ucrania
russia
putin
zelensky
kremlin
israel = 2
palestina
hamas
gaza
teera
oriente medio
china comunista
partido comunista chines
pcc
xi jinping
taiwan
hong kong
tibete
uigur
uigures
imperialismo = 2
imperialista
colonialismo
colonial
colonizacao
colonizador
descolonizacao
descolonial
decolonial
neocolonial
intervencao militar americana
guerra do iraque
iraque
afeganistao
vietna
guerra do vietna
otan
trump = 2
donald trump
maga
republicanos
partido republicano
democratas
partido democrata
biden
obama
kamala
clinton
bernie
bernie sanders
aoc
ocasio cortez
elon musk
musk
milton friedman
reagan
reaganomics
thatcher = 2
margaret thatcher
thatcherismo
churchill
de gaulle
macron
franceses
orban
hungria
meloni
espanha
portugal
bukele = 2
nayib bukele
el salvador
mega prisao
cecot
kast
uruguai
mujica
paraguai
bolivia
evo morales
colombia
petro
gustavo petro
amlo
sheinbaum
brasil = 1
brasileiro
brasileiros
brasilia
planalto
palacio do planalto
alvorada
esplanada
governo federal
governo estadual
governo municipal
estados e municipios
pacto federativo
federativo
ministerio
ministerios
ministro
ministros
ministra
secretaria
secretario
autarquia
autarquias
fundacao publica
estatal
estatais
correios
petrobras
caixa economica
banco do brasil
bndes
eletrobras
embraer
vale do rio doce
sabesp
copel
cemig
privatizacao da petrobras
privatizacao dos correios
privatizacao da eletrobras
tv publica
ebc
tv brasil
midia
imprensa
jornalismo
jornalista
jornalistas
jornais
rede globo
jornal nacional
folha de sao paulo
estadao
cnn
cnn brasil
jovem pan
gazeta do povo
revista oeste
brasil paralelo
antagonista
o antagonista
poder360
g1
sbt
midia tradicional
grande midia
velha midia
midia alternativa
midia independente
extrema imprensa
imprensa golpista
imprensa marrom
viés
vies
enviesado
parcialidade
imparcialidade
checagem
fact check
fact-checking
agencia lupa
aos fatos
comprova
redes sociais
twitter
facebook
instagram
youtube
telegram
whatsapp
algoritmo
algoritmos
shadowban
banimento
banido
banida
desmonetizacao
desmonetizado
regulacao das redes
regulacao da internet
marco civil
marco civil da internet
lgpd
privacidade
vigilancia
estado de vigilancia
vigilancia em massa
espionagem
abin
cia
fbi
nsa
snowden
wikileaks
assange
big brother
1984
orwell = 2
george orwell
orwelliano
a revolucao dos bichos
revolucao dos bichos
admiravel mundo novo
huxley
distopia
distopico
kafka
kafkiano
utopia
utopico
utopista
engenharia social = 2
engenheiro social
engenheiros sociais
planejamento central = 2
planejador central
planejadores centrais
planificacao
economia planificada
economia planejada
plano quinquenal
planos quinquenais
gosplan
comando e controle
economia de comando
coletivismo = 2
coletivista = 2
coletivistas
coletivo
o coletivo
bem comum = 2
bem estar social
bem-estar social
interesse publico
interesse coletivo
interesse geral
interesse nacional
utilidade publica
funcao social = 2
funcao social da propriedade
funcao social da terra
propriedade e roubo
a propriedade e um roubo
proudhon
bakunin
kropotkin
anarquismo classico
anarcossindical*
anarcosindical*
anarco-sindicalismo
anarcocomunis*
anarco-comunismo
comunismo libertario
autogestao
cooperativa
cooperativas
cooperativismo
economia solidaria
individualismo = 2
individualista = 2
individualistas
individuo
individuos
liberdade individual = 2
liberdades individuais
direitos individuais = 2
direito individual
direitos civis
direitos humanos = 2
direito humano
dudh
declaracao universal
direitos fundamentais
garantias fundamentais
garantias individuais
habeas corpus
devido processo
devido processo legal
presuncao de inocencia
ampla defesa
contraditorio
estado de direito = 2
rule of law
imperio da lei
governo das leis
seguranca juridica
liberdade
liberdades
libertacao
libertar
liberdade economica = 2
liberdade de mercado
liberdade negativa
liberdade positiva
isaiah berlin
berlin
dois conceitos de liberdade
tolerancia
intolerancia
intolerante
pluralismo
pluralista
sociedade aberta = 2
popper
karl popper
inimigos da sociedade aberta
paradoxo da tolerancia
falseabilidade
falsificacionismo
contrato social = 2
contratualismo
contratualista
hobbes = 2
thomas hobbes
leviata
leviathan
estado de natureza
guerra de todos contra todos
homo homini lupus
locke = 2
john locke
segundo tratado
dois tratados
vida liberdade e propriedade
rousseau = 2
jean jacques rousseau
bom selvagem
vontade geral
o contrato social
montesquieu
espirito das leis
tocqueville = 2
alexis de tocqueville
democracia na america
a democracia na america
maquiavel
o principe
maquiavelico
platao
rei filosofo
aristoteles = 2
politica de aristoteles
zoon politikon
animal politico
cicero
santo agostinho
cidade de deus
a cidade de deus
tomas de aquino
suma teologica
governo dos principes
de regno
kant
paz perpetua
hegel
hegeliano
filosofia do direito
nietzsche
vontade de poder
weber
max weber
etica protestante
monopolio legitimo da violencia
dominacao legitima
carl schmitt = 2
schmitt
amigo inimigo
amigo e inimigo
decisionismo
estado de excecao
leo strauss
strauss
straussiano
hannah arendt = 2
arendt
banalidade do mal
origens do totalitarismo
eric voegelin = 2
voegelin
gnosticismo politico
imanentizar o eschaton
religiao politica
religioes politicas
raymond aron
aron
opio dos intelectuais
julien benda
traicao dos intelectuais
intelectuais
intelectual
intelligentsia
academia
academico
universidade
universidades
professor
professores
docente
ensino superior
unicamp
harvard
cambridge
teorias
ciencia politica
cientista politico
sociologia
sociologo
sociologos
antropologia
antropologo
filosofia politica = 2
filosofo
filosofos
filosofia
filosofico
filosofica
epistemologia
metafisica
ontologia
retorica
sofisma
sofista
sofistas
`;

const CATOLICISMO = `
catol* = 2
catolicismo = 2
catolico = 2
catolica = 2
catolicos
catolicas
igreja
igrejas
igreja catolica = 2
santa igreja
santa madre igreja
igreja romana
igreja de roma
roma
vaticano = 2
santa se
santa sé
se apostolica
curia
curia romana
papa
papas
papado
pontifice
sumo pontifice
pontificado
santo padre
vigario de cristo
sucessor de pedro
cadeira de pedro
catedra de pedro
ex cathedra
infalibilidade
infalibilidade papal
infalivel
magisterio = 2
magisterio da igreja
magisterio ordinario
magisterio extraordinario
tradicao apostolica
sucessao apostolica
deposito da fe
depositum fidei
leao xiv = 2
leao 14
leao xiii = 2
leao 13
francisco
papa francisco
bergoglio
bento xvi = 2
bento 16
ratzinger
joseph ratzinger
joao paulo ii = 2
joao paulo 2
joao paulo segundo
wojtyla
karol wojtyla
paulo vi
paulo 6
joao xxiii
joao 23
pio xii
pio 12
pio xi
pio 11
pio x
pio 10
sao pio x
pio ix
pio 9
gregorio xvi
leao magno
gregorio magno
sao gregorio
sao pedro = 2
sao paulo
apostolo paulo
paulo apostolo
apostol*
apostolo
apostolos
doze apostolos
os doze
evangelista
evangelistas
sao joao
sao mateus
sao marcos
sao lucas
sao tiago
sao judas
judas iscariotes
sao tome
santo andre
conclave
cardeal = 2
cardeais
colegio cardinalicio
bispo = 2
bispos
arcebispo
arcebispos
episcopado
episcopal
diocese
dioceses
arquidiocese
cnbb = 2
conferencia episcopal
conferencia dos bispos
padre
padres
sacerdote = 2
sacerdotes
sacerdocio
sacerdotal
presbitero
presbiterio
clero = 2
clerigo
clerigos
clerical
clericalismo
anticlerical
anticlericalismo
diacono
diaconos
diaconato
seminario
seminarista
seminaristas
vocacao = 2
vocacoes
vocacional
vocacao sacerdotal
vocacao religiosa
celibato = 2
celibatario
castidade = 2
casto
pureza
virgindade
virgem
freira = 2
freiras
religiosa
religiosas
monja
monjas
monge = 2
monges
monastico
monasticismo
mosteiro
mosteiros
abadia
abade
abadessa
convento
conventos
claustro
clausura
vida consagrada
consagrado
consagrada
consagracao
ordem religiosa
ordens religiosas
congregacao
congregacoes
instituto religioso
beneditino = 2
beneditinos
sao bento = 2
regra de sao bento
ora et labora
franciscano = 2
franciscanos
sao francisco = 2
francisco de assis
santa clara
clarissas
capuchinho
capuchinhos
dominicano = 2
dominicanos
sao domingos
ordem dos pregadores
jesuita = 2
jesuitas
companhia de jesus
santo inacio = 2
inacio de loyola
exercicios espirituais
ad maiorem dei gloriam
amdg
carmelita
carmelitas
carmelo
santa teresa = 2
teresa de avila
teresa davila
sao joao da cruz
joao da cruz
noite escura
santa teresinha = 2
teresinha
teresa de lisieux
pequena via
pequeno caminho
agostiniano
agostinianos
santo agostinho = 2
agostinho
confissoes
cidade de deus
tomas de aquino = 2
sao tomas = 2
sao tomas de aquino = 2
aquinate
tomismo = 2
tomista = 2
tomistas
neotomismo
neotomista
suma teologica = 2
summa theologiae
summa
suma contra os gentios
cinco vias
quinque viae
ato e potencia
essencia e existencia
lei eterna
lei natural = 2
lei divina
lei humana
virtude* = 2
virtudes cardeais
virtudes teologais
prudencia
justica
fortaleza
temperanca
fe
esperanca
caridade
fe esperanca e caridade
vicio
vicios
pecado = 2
pecados
pecador
pecadores
pecar
pecado mortal
pecado venial
pecado original = 2
pecados capitais
sete pecados
soberba
orgulho
avareza
luxuria
gula
inveja
preguica
acidia
acedia
vangloria
humildade
humilde
mansidao
paciencia
paciente
misericordia
misericordioso
perdao
perdoar
arrependimento
arrepender
contricao
atricao
penitencia = 2
penitente
mortificacao
jejum
abstinencia
sexta feira da paixao
quaresma = 2
quarta feira de cinzas
semana santa
domingo de ramos
quinta feira santa
sexta feira santa
sabado santo
vigilia pascal
pascoa
pascoa da ressurreicao
ressurreicao = 2
ressuscitou
ressuscitado
ascensao
pentecostes
espirito santo = 2
paraclito
dons do espirito
dons do espirito santo
frutos do espirito
carisma
carismas
carismatico
renovacao carismatica
rcc
advento = 2
natal
nascimento de jesus
encarnacao = 2
verbo encarnado
verbo se fez carne
epifania
reis magos
apresentacao do senhor
candelaria
anunciacao
visitacao
assuncao = 2
assuncao de maria
imaculada conceicao = 2
imaculada
virgem maria = 2
santa maria
nossa senhora = 2
mae de deus
theotokos
mae de jesus
mae da igreja
rainha do ceu
salve maria = -2
ave maria = -2
salve rainha
mariano
mariana
mariologia
marial
devocao mariana
consagracao a maria
totus tuus
montfort
luis de montfort
sao luis maria
tratado da verdadeira devocao
aparecida
nossa senhora aparecida
padroeira
padroeira do brasil
fatima
nossa senhora de fatima
segredo de fatima
tres pastorinhos
jacinta
francisco marto
lourdes
nossa senhora de lourdes
bernadette
guadalupe = 2
nossa senhora de guadalupe
juan diego
tilma
medjugorje
nossa senhora do carmo
escapulario
nossa senhora das gracas
medalha milagrosa
nossa senhora do rosario
rosario = 2
terco = 2
tercos
rezar o terco
misterios do rosario
misterios gozosos
misterios dolorosos
misterios gloriosos
misterios luminosos
angelus
angelus domini
regina caeli
magnificat
santo
santidade
santificacao
santificar
comunhao dos santos
intercessao
intercessao dos santos
intercessor
interceder
padroeiro
padroeiros
canonizacao
canonizado
canonizada
beatificacao
beatificado
beato
beata
serva de deus
servo de deus
veneravel
causa de canonizacao
milagre = 2
milagres
milagroso
relíquia
reliquia
reliquias
santuario
santuarios
peregrinacao
peregrino
peregrinos
romaria
romeiro
romeiros
caminho de santiago
santiago de compostela
sao jose = 2
santo antonio
santo antonio de padua
sao judas tadeu
sao jorge
sao sebastiao
sao miguel = 2
miguel arcanjo
sao miguel arcanjo
sao gabriel
sao rafael
arcanjo
arcanjos
anjo
anjos
anjo da guarda
angelico
angelologia
anjos caidos
demonio = 2
demonios
diabo = 2
satanas
satan
lucifer
belzebu
capeta
inimigo
tentacao
tentacoes
tentador
exorcismo = 2
exorcista
possessao
possesso
possuido
endemoninhado
libertacao espiritual
batalha espiritual
combate espiritual
guerra espiritual
inferno = 2
condenacao
condenado
condenados
danacao
perdicao
purgatorio = 2
almas do purgatorio
indulgencia
indulgencias
indulgencia plenaria
ceu
paraiso
reino dos ceus
reino de deus
vida eterna
salvacao = 2
salvador
redencao
redentor
remissao
remissao dos pecados
justificacao
graca santificante
graca atual
estado de graca
sola fide
sola scriptura
sola gratia
somente a fe
so a fe
fe e obras
fe sem obras
boas obras
merito
meritos
predestinacao
livre arbitrio = 2
livre-arbitrio
liberdade humana
vontade livre
providencia = 2
providencia divina
divina providencia
vontade de deus
plano de deus
desígnio
designio
designios
deus
deuses
divino
divina
divindade
nosso senhor = 2
jesus
jesus cristo = 2
cristo
cristo jesus
cristologia
messias
filho de deus
filho do homem
cordeiro de deus
agnus dei
bom pastor
rei dos reis
alfa e omega
emanuel
emmanuel
nazareno
jesus de nazare
nazare
belem
galileia
jerusalem
judeia
samaria
mar da galileia
jordao
rio jordao
monte das oliveiras
getsemani
golgota
calvario
via sacra
via crucis
estacoes da via sacra
paixao de cristo
crucificacao
crucificado
santa cruz
sinal da cruz
crucifixo
sangue de cristo
preciosissimo sangue
sagrado coracao = 2
sagrado coracao de jesus
coracao de jesus
imaculado coracao
coracao de maria
divina misericordia
santa faustina
faustina
jesus eu confio em vos
terco da misericordia
hora da misericordia
trindade = 2
santissima trindade = 2
trino
triuno
pai filho e espirito santo
deus pai
deus filho
consubstancial
homoousios
hipostase
uniao hipostatica
duas naturezas
verdadeiro deus e verdadeiro homem
credo = 2
creio
creio em deus pai
credo niceno
credo de niceia
credo dos apostolos
simbolo dos apostolos
simbolo niceno
niceia
concilio de niceia
concilio = 2
concilios
conciliar
concilio de trento = 2
trento
tridentino
contrarreforma
contra-reforma
reforma catolica
concilio vaticano = 2
vaticano ii = 2
vaticano 2
vaticano segundo
vaticano i
vaticano 1
concilio vaticano ii
pos concilio
pos-concilio
espirito do concilio
hermeneutica da continuidade
hermeneutica da ruptura
concilio de calcedonia
calcedonia
concilio de efeso
efeso
concilio de constantinopla
concilio de latrao
latrao
concilio de florenca
concilio de constanca
dogma = 2
dogmas
dogmatico
dogmatica
doutrina = 2
doutrinas
doutrinal
doutrina catolica = 2
doutrina da igreja
doutrina social = 2
doutrina social da igreja = 2
dsi = 2
ensino social
ensino social da igreja
subsidiariedade = 2
principio da subsidiariedade
solidariedade
principio da solidariedade
destino universal dos bens = 2
destinacao universal dos bens
bem comum = 2
dignidade da pessoa
dignidade humana
dignidade da pessoa humana
pessoa humana
opcao pelos pobres
opcao preferencial
opcao preferencial pelos pobres
rerum novarum = 2
quadragesimo anno
mater et magistra
pacem in terris
gaudium et spes
populorum progressio
laborem exercens
sollicitudo rei socialis
centesimus annus = 2
caritas in veritate
laudato si
laudato si'
fratelli tutti
evangelii gaudium
amoris laetitia
veritatis splendor = 2
fides et ratio
evangelium vitae
humanae vitae = 2
familiaris consortio
dignitatis humanae
lumen gentium
dei verbum
sacrosanctum concilium
nostra aetate
unitatis redintegratio
apostolicam actuositatem
ad gentes
presbyterorum ordinis
optatam totius
perfectae caritatis
gravissimum educationis
inter mirifica
christus dominus
orientalium ecclesiarum
summorum pontificum
traditionis custodes
quo primum
pascendi
lamentabili
syllabus
silabo
silabo de erros
syllabus errorum
quanta cura
mirari vos
mit brennender sorge
divini redemptoris
non abbiamo bisogno
casti connubii
mystici corporis
humani generis
divino afflante spiritu
mediator dei
haurietis aquas
ad caeli reginam
munificentissimus deus
ineffabilis deus
pastor aeternus
dei filius
aeterni patris
libertas
immortale dei
providentissimus deus
satis cognitum
testem benevolentiae
enciclica = 2
enciclicas
carta enciclica
exortacao apostolica
exortacao
constituicao apostolica
motu proprio
bula papal
carta apostolica
declaracao
instrucao
documento
documento do vaticano
documentos do concilio
catecismo = 2
catecismo da igreja
catecismo da igreja catolica
cic
catecismo romano
catecismo de trento
catecismo de sao pio x
catequese = 2
catequista
catequistas
catequizar
catecumeno
catecumenato
rcia
teologia = 2
teologico
teologica
teologo = 2
teologos
teologia moral
teologia dogmatica
teologia fundamental
teologia sistematica
teologia pastoral
teologia biblica
teologia da libertacao = 2
teologia da prosperidade
leonardo boff = 2
boff
gutierrez
gustavo gutierrez
frei betto = 2
frei beto
ceb
cebs
comunidades eclesiais de base
pastoral da terra
cpt
pastoral
pastorais
pastoral da juventude
pastoral familiar
pastoral social
ministerio
ministerios
ministro extraordinario
ministro da eucaristia
acolito
coroinha
coroinhas
sacristao
sacristia
paroquia = 2
paroquias
paroquial
paroco = 2
parocos
vigario
vigario paroquial
capelania
capelao
igreja matriz
catedral = 2
catedrais
basilica = 2
basilicas
sao pedro
basilica de sao pedro
praca de sao pedro
lateranense
sao joao de latrao
santa maria maior
sao paulo fora dos muros
capela sistina
missa = 2
missas
santa missa = 2
sacrificio da missa
santo sacrificio
liturgia = 2
liturgico
liturgica
liturgias
rito = 2
ritos
rito romano
rito latino
rito oriental
ritos orientais
rito ambrosiano
rito mocarabe
rito bizantino
missa tridentina = 2
tridentina
missa em latim = 2
missa latina
missa de sempre
usus antiquior
forma extraordinaria
forma ordinaria
vetus ordo = 2
novus ordo = 2
missa nova
missal
missal romano
missal de 1962
missal de sao pio v
sao pio v
pio v
latim = 2
latina
lingua latina
gregoriano = 2
canto gregoriano
gregoriano
polifonia
palestrina
musica sacra
musica liturgica
organista
ad orientem
versus populum
de costas para o povo
de frente para o povo
comunhao na boca
comunhao na mao
comunhao de joelhos
de joelhos
genuflexao
genuflectir
ajoelhar
ajoelhado
altar = 2
altares
mesa do altar
sacrario = 2
tabernaculo
ambao
presbiterio
sacristia
batistério
batisterio
pia batismal
agua benta
incenso
turibulo
turiferario
casula
estola
batina = 2
batinas
sotaina
colarinho
colarinho romano
clergyman
habito religioso
veu na missa
mantilha
capa de asperges
mitra
baculo
palio
anel do pescador
solideu
solidéu
barrete
tiara papal
sedia gestatoria
sacramento = 2
sacramentos
sete sacramentos
sacramental
sacramentais
batismo = 2
batizado
batizar
batizada
crisma = 2
crismado
confirmacao
eucaristia = 2
eucaristico
eucaristica
comunhao = 2
comungar
primeira comunhao
primeira eucaristia
santissimo = 2
santissimo sacramento
presenca real = 2
transubstanciacao = 2
transubstanciado
consagracao
hostia = 2
hostia consagrada
corpo de cristo = 2
corpo e sangue
corpus christi = 2
adoracao = 2
adoracao eucaristica
adoracao ao santissimo
hora santa
exposicao do santissimo
bencao do santissimo
ostensorio
custodia
calice
patena
ambula
cibório
ciborio
corporal
sanguineo
purificador
pao e vinho
pao azimo
particula
milagre eucaristico
milagres eucaristicos
lanciano
confissao = 2
confessar
confessionario
confessor
sacramento da confissao
sacramento da penitencia
sacramento da reconciliacao
reconciliacao
absolvicao
absolver
absolvido
sigilo sacramental
sigilo da confissao
exame de consciencia
uncao dos enfermos = 2
extrema uncao
uncao
santos oleos
oleo dos enfermos
oleo dos catecumenos
crisma
santo crisma
viatico
sacramento da ordem
ordenacao
ordenacao sacerdotal
ordenacao episcopal
ordenacao diaconal
ordenado
imposicao das maos
matrimonio = 2
sacramento do matrimonio
casamento
casamento na igreja
casamento religioso
casar na igreja
noivado
nubentes
nulidade
nulidade matrimonial
anulacao
anulacao do casamento
tribunal eclesiastico
indissolubilidade = 2
indissoluvel
divorcio = 2
divorciado
divorciados
segunda uniao
recasados
recasado
divorciados recasados
uniao estavel
concubinato
amasiado
fidelidade
fidelidade conjugal
adulterio = 2
adultero
traicao
fornicacao
sexo antes do casamento
sexo fora do casamento
coabitacao
morar junto
morar juntos
abertura a vida
abertos a vida
aberto a vida
paternidade responsavel
planejamento familiar
metodos naturais
billings
metodo billings
sintotermico
contracepcao = 2
contraceptivo
contraceptivos
anticoncepcional = 2
anticoncepcionais
pilula
camisinha
preservativo
preservativos
esterilizacao
vasectomia
laqueadura
fertilizacao in vitro
fiv
reproducao assistida
barriga de aluguel
utero de aluguel
embriao
embrioes
embriao humano
celulas tronco
celulas-tronco
clonagem
eugenia
eugenismo
aborto = 2
abortos
abortar
abortista
abortivo
abortivos
pro vida = 2
pro-vida
pro life
pro escolha
pro-escolha
pro choice
direito de escolha
direito ao aborto
descriminalizacao do aborto
legalizacao do aborto
aborto legal
vida desde a concepcao
comeca na concepcao
feto
fetos
nascituro
vida intrauterina
adpf 442
adpf 54
anencefalo
estupro
aborto em caso de estupro
eutanasia = 2
suicidio assistido
morte assistida
morte digna
distanasia
ortotanasia
cuidados paliativos
suicidio
pena de morte = 2
pena capital
execucao
execucoes
cultura da morte = 2
cultura de morte
cultura da vida
evangelho da vida
familia
familias
familiar
familia natural
familia tradicional
pai mae e filhos
pai e mae
paternidade
maternidade
educacao dos filhos
criar os filhos
criacao dos filhos
patrio poder
poder familiar
direito dos pais
pais tem o direito
ideologia de genero = 2
teoria de genero
identidade de genero
transgenero
transexual
trans
transicao de genero
bloqueadores de puberdade
bloqueador hormonal
cirurgia de redesignacao
mudanca de sexo
banheiro
banheiros
esportes femininos
homossexualidade = 2
homossexual
homossexuais
gay
gays
lesbica
lesbicas
lgbt = 2
lgbtq
lgbtqia
lgbtqia+
orgulho gay
parada gay
parada lgbt
casamento gay = 2
casamento homoafetivo
uniao homoafetiva
uniao civil
adocao por casais gays
adocao homoafetiva
bencao de casais
bencao a casais
fiducia supplicans
fiducia
atos homossexuais
inclinacao homossexual
desordem
desordenado
intrinsecamente desordenado
pornografia = 2
porno
pornografico
masturbacao
onanismo
impureza
impuro
concupiscencia
tentacao da carne
pecados da carne
sexualidade
sexo
relacao sexual
ato conjugal
ato sexual
teologia do corpo = 2
amor e responsabilidade
educacao sexual
sexualizacao
sexualizacao infantil
erotizacao
pedofilia
abuso sexual
abusos na igreja
escandalo dos abusos
encobrimento
zero tolerancia
pedofilia na igreja
mccarrick
sao joao paulo ii
santo padre pio = 2
padre pio
pio de pietrelcina
estigmas
estigmatizado
santa rita
santa rita de cassia
santa edwiges
sao benedito
santa luzia
santa barbara
sao cosme
sao damiao
sao roque
sao cristovao
sao lazaro
sao lourenco
sao vicente
sao vicente de paulo
vicentino
vicentinos
ssvp
sociedade sao vicente de paulo
santa isabel
santa monica
santa ana
sao joaquim
santa catarina
catarina de sena
santa catarina de sena
santa joana darc
joana darc
joana d'arc
sao patricio
santo expedito
sao charbel
santa teresa de calcuta
madre teresa
teresa de calcuta
sao maximiliano kolbe
kolbe
maximiliano kolbe
santa gianna
gianna beretta molla
sao josemaria = 2
josemaria escriva = 2
escriva = 2
escrivá
sao jose maria escriva
opus dei = 2
forja
amigos de deus
e cristo que passa
santificacao do trabalho
santificar o trabalho
trabalho santificado
numerario
supernumerario
agregado
cooperador
prelatura
prelatura pessoal
prelado
sao joao bosco = 2
dom bosco = 2
salesiano
salesianos
santa maria mazzarello
sao domingos savio
domingos savio
sao filipe neri
filipe neri
oratorio
oratorianos
newman = 2
john henry newman
sao joao henrique newman
cardeal newman
apologia pro vita sua
desenvolvimento da doutrina
gramatica do assentimento
chesterton = 2
g k chesterton
gk chesterton
ortodoxia
o homem eterno
padre brown
distributismo = 2
distributista
distributistas
belloc = 2
hilaire belloc
o estado servil
estado servil
tres acres e uma vaca
c s lewis = 2
cs lewis
cristianismo puro e simples
mero cristianismo
cartas de um diabo
cartas do diabo ao seu aprendiz
narnia
tolkien = 2
j r r tolkien
senhor dos aneis
o senhor dos aneis
silmarillion
hobbit
eucatastrofe
subcriacao
dostoievski = 2
dostoevsky
irmaos karamazov
os irmaos karamazov
grande inquisidor
o grande inquisidor
crime e castigo
memorias do subsolo
os demonios
tolstoi
pascal = 2
blaise pascal
pensamentos
aposta de pascal
descartes
santo anselmo
anselmo
argumento ontologico
proslogion
fides quaerens intellectum
boecio
consolacao da filosofia
sao jeronimo
jeronimo
vulgata
santo ambrosio
ambrosio
santo atanasio
atanasio
contra arianos
arianismo
ario
sao basilio
basilio magno
gregorio de nissa
gregorio nazianzeno
capadocios
padres capadocios
joao crisostomo
crisostomo
cirilo de alexandria
cirilo
santo ireneu
ireneu
ireneu de liao
contra as heresias
adversus haereses
justino martir
sao justino
tertuliano
origenes
clemente de alexandria
inacio de antioquia
santo inacio de antioquia
policarpo
sao policarpo
didaque
didache
padres da igreja = 2
padres apostolicos
patristica = 2
patrologia
santos padres
escolastica = 2
escolastico
escolasticos
escola de salamanca = 2
salamanca
vitoria
francisco de vitoria
francisco suarez
domingo de soto
molinismo
banez
banezianismo
juan de mariana
mariana
martin de azpilcueta
azpilcueta
escolasticos tardios
segunda escolastica
duns scoto
escoto
escotismo
guilherme de ockham
ockham
navalha de ockham
nominalismo
nominalista
realismo
universais
problema dos universais
abelardo
boaventura
sao boaventura
alberto magno
santo alberto magno
sao bernardo
bernardo de claraval
cistercienses
cisterciense
trapista
trapistas
cartuxos
cartuxa
premonstratenses
sao norberto
heresia = 2
heresias
herege
hereges
heretico
heretica
heterodoxia
heterodoxo
ortodoxia = 2
ortodoxo
ortodoxos
igreja ortodoxa
ortodoxia oriental
patriarca
patriarcado
constantinopla
cisma = 2
cisma do oriente
grande cisma
cisma do ocidente
1054
filioque
cismatico
cismaticos
excomunhao = 2
excomungado
excomungar
anatema
anatematizar
interdito
suspensao a divinis
a divinis
reducao ao estado laical
laicizacao
inquisicao = 2
santa inquisicao
inquisidor
inquisidores
tribunal do santo oficio
santo oficio
cruzada = 2
cruzadas
cruzado
cruzados
terra santa
templarios
cavaleiros templarios
hospitalarios
ordem de malta
teutonicos
reconquista
lepanto
batalha de lepanto
cerco de viena
sobieski
jan sobieski
protestante = 2
protestantes
protestantismo = 2
reforma protestante = 2
reforma
lutero = 2
martinho lutero
luterano
luteranos
luteranismo
95 teses
noventa e cinco teses
calvino = 2
calvinismo = 2
calvinista
calvinistas
tulip
zwinglio
zwingli
henrique viii
henrique 8
anglicano
anglicanos
anglicanismo
igreja anglicana
igreja da inglaterra
tomas moro = 2
thomas more
sao tomas moro
joao fisher
sao joao fisher
martires ingleses
tyburn
evangelico = 2
evangelicos
evangelica
evangelicas
pentecostal
pentecostais
neopentecostal
neopentecostais
universal
igreja universal
edir macedo
malafaia
silas malafaia
assembleia de deus
batista
batistas
presbiteriano
presbiterianos
metodista
metodistas
adventista
adventistas
testemunha de jeova
testemunhas de jeova
mormon
mormons
mórmon
crente
crentes
pastor
pastores
pastora
bancada evangelica
teologia reformada
reformado
reformados
sola scriptura
somente a escritura
so a escritura
apenas a biblia
livre exame
livre interpretacao
biblia
biblico
biblica
sagrada escritura = 2
sagradas escrituras
escritura
escrituras
palavra de deus = 2
antigo testamento
velho testamento
novo testamento
evangelho = 2
evangelhos
sinoticos
evangelhos sinoticos
genesis
exodo
levitico
deuteronomio
pentateuco
tora
torah
neemias
macabeus
salmos = 2
salmo
salmo 23
salmo 91
proverbios
eclesiastes
cantico dos canticos
eclesiastico
siracida
isaias
jeremias
lamentacoes
ezequiel
miqueias
naum
habacuc
sofonias
malaquias
profeta
profetas
profecia
profecias
profetico
atos dos apostolos
romanos
carta aos romanos
corintios
galatas
efesios
filipenses
colossenses
tessalonicenses
hebreus
carta aos hebreus
epistola
epistolas
epistola de tiago
carta de tiago
apocalipse = 2
livro do apocalipse
revelacao
fim dos tempos
fim do mundo
escatologia
escatologico
parusia
segunda vinda
juizo final
julgamento final
anticristo
marca da besta
666
armagedon
milenarismo
milenarista
dispensacionalismo
arrebatamento
deuterocanonico
deuterocanonicos
apocrifo
apocrifos
canon
canon biblico
septuaginta
lxx
texto massoretico
masoretico
vulgata
neovulgata
biblia de jerusalem
biblia ave maria
biblia cnbb
biblia pastoral
biblia sagrada
traducao
traducoes
exegese
exegeta
hermeneutica
hermeneutica biblica
sentido literal
sentido espiritual
sentido alegorico
sentido moral
sentido anagogico
metodo historico critico
historico critico
inerrancia
inspiracao
inspirado
divinamente inspirado
revelacao
revelacao divina
revelacao publica
revelacao privada
revelacoes privadas
aparicao
aparicoes
aparicao mariana
aparicoes marianas
vidente
videntes
mensagem
mensagens
locucao
locucoes
mistica
mistico
misticos
misticismo
experiencia mistica
extase
levitacao
bilocacao
incorrupto
incorruptos
corpo incorrupto
santo sudario
sudario
sudario de turim
sindone
veu de veronica
veronica
lanca sagrada
santo graal
graal
arca da alianca
arca
cruz verdadeira
vera cruz
santa helena
constantino
edito de milao
cristianismo = 2
cristao = 2
cristaos = 2
cristas
cristandade
mundo cristao
ocidente cristao
civilizacao crista
civilizacao ocidental = 2
raizes cristas
valores cristaos
etica crista
moral crista
cosmovisao crista
visao crista
fe cristã
fe crista
vida crista
testemunho cristao
testemunho
testemunhar
martir = 2
martires
martirio
martirizado
sangue dos martires
semente de cristaos
perseguicao = 2
perseguicoes
perseguido
perseguidos
perseguicao aos cristaos
cristaos perseguidos
cristofobia
anticristao
anticatolico
anticatolicismo
catolicofobia
evangelizacao = 2
evangelizar
evangelizador
nova evangelizacao
missoes
missionario
missionarios
ad gentes
mandato missionario
ide e fazei discipulos
grande comissao
conversao
converter
convertido
convertida
convertidos
converso
metanoia
apostasia = 2
apostata
apostatas
apostatar
abandonar a fe
perder a fe
crise de fe
descrenca
incredulo
incredulidade
ateismo = 2
ateu = 2
ateus
ateia
ateista
agnostico = 2
agnosticismo
agnosticos
cetico
ceticismo
ceticos
secularismo = 2
secularizacao
secular
secularizado
laicismo = 2
laicista
laico
laica
estado laico = 2
laicidade
separacao igreja e estado
igreja e estado
religiao e politica
relativismo = 2
relativista
ditadura do relativismo
relativismo moral
niilismo
niilista
materialismo = 2
materialista
naturalismo
naturalista
cientificismo
cientificista
racionalismo
racionalista
positivismo
positivista
comte
auguste comte
humanismo secular
humanismo
humanista
antropocentrismo
antropocentrico
teocentrismo
teocentrico
deismo
deista
panteismo
panteista
espinosa
spinoza
gnosticismo = 2
gnostico
gnosticos
gnose
maniqueismo
maniqueista
maniqueu
pelagianismo
pelagiano
semipelagianismo
neopelagianismo
jansenismo
jansenista
modernismo = 2
modernista
modernistas
heresia modernista
modernismo teologico
sincretismo
sincretico
relativismo religioso
indiferentismo
indiferentismo religioso
todas as religioes
todas as religioes sao iguais
todos os caminhos levam a deus
ecumenismo = 2
ecumenico
dialogo inter religioso
dialogo inter-religioso
dialogo interreligioso
dialogo ecumenico
assis
encontro de assis
pachamama
sinodo = 2
sinodal
sinodalidade
sinodo da amazonia
sinodo da sinodalidade
sinodo da familia
caminho sinodal
caminho sinodal alemao
igreja alema
bispos alemaes
sacerdocio feminino
ordenacao de mulheres
mulheres padres
diaconisas
diaconato feminino
viri probati
padres casados
fim do celibato
progressismo na igreja
progressista catolico
catolico progressista
catolico liberal
catolico de esquerda
esquerda catolica
catolico conservador
catolico tradicional
tradicionalismo catolico
tradicionalista = 2
tradicionalistas
trad
trads
tradcat
tradcats
rad trad
rad trads
fsspx = 2
sspx
fraternidade sao pio x
fraternidade sacerdotal sao pio x
lefebvre = 2
dom lefebvre
marcel lefebvre
lefebvrista
lefebvristas
ecclesia dei
fssp
fraternidade sao pedro
instituto cristo rei
icrss
sedevacantismo = 2
sedevacantista
sedevacantistas
sede vacante
sedevacante
sedeprivacionismo
tese de cassiciacum
papa herege
papa invalido
antipapa
benevacantismo
bento ainda e o papa
resignacao de bento
renuncia de bento
renuncia do papa
vigano = 2
carlo maria vigano
arcebispo vigano
burke = 2
cardeal burke
raymond burke
cardeal sarah
robert sarah
cardeal muller
gerhard muller
schneider
dom athanasius
athanasius schneider
strickland
bispo strickland
dubia
os dubia
cinco dubia
dom henrique
dom henrique soares
dom bertrand
dom orani
cardeal orani
dom odilo
cardeal odilo
dom walmor
dom fernando
padre paulo ricardo = 2
paulo ricardo
padre paulo
padre fabio de melo
fabio de melo
padre marcelo
marcelo rossi
padre reginaldo
reginaldo manzotti
padre alessandro campos
padre joaozinho
padre zezinho
padre leo
padre leo
frei gilson
padre chrystian
padre mario sartori
canção nova = 2
cancao nova
tv cancao nova
tv aparecida
rede vida
tv seculo 21
comunidade shalom
shalom
comunidade catolica
comunidades novas
novas comunidades
toca de assis
alianca de misericordia
obra de maria
fazenda da esperanca
fazenda esperanca
frei hans
apostolado
apostolo
apostola
apostolos leigos
leigo = 2
leigos
laicato
laical
vocacao laical
missao dos leigos
pastoral dos leigos
movimento
movimentos
movimentos eclesiais
encontro de casais
ecc
encontro de casais com cristo
cursilho
cursilhos
legiao de maria = 2
legionario
legionarios
apostolado da oracao
terco dos homens = 2
terço dos homens
terco das mulheres
mae rainha
schoenstatt
schoenstadt
focolares
focolare
comunhao e libertacao
neocatecumenal
caminho neocatecumenal
emmanuel
comunidade emanuel
sao joao apostolo
pequenas comunidades
grupo de oracao
grupos de oracao
oracao
oracoes
rezar
reza
rezando
orar
orando
orante
vida de oracao
oracao mental
oracao vocal
oracao contemplativa
contemplacao
contemplativo
meditacao
meditar
lectio divina
lectio
liturgia das horas = 2
oficio divino
laudes
vesperas
completas
breviario
brevíario
horas canonicas
matinas
adoracao
louvor
louvar
louvado seja = -1
louvado seja nosso senhor jesus cristo = -1
para sempre seja louvado = -1
gloria a deus
gloria in excelsis
te deum
aleluia
amem = -1
amen = -1
hosana
kyrie
kyrie eleison
agnus dei
sanctus
santo santo santo
pai nosso = 2
pai-nosso
gloria ao pai
credo
salve rainha
sao miguel arcanjo defendei nos
oracao de sao miguel
oracao a sao miguel
oracao da manha
oracao da noite
oracao antes das refeicoes
bencao da mesa
bencao = 2
bencaos
abencoar = 2
abencoado
abencoada
abencoados
deus abencoe = -2
deus te abencoe = -2
deus lhe abencoe = -2
deus os abencoe = -2
deus abencoe a todos = -2
fica com deus = -2
fique com deus = -2
fiquem com deus = -2
vai com deus = -2
va com deus = -2
durma com deus = -2
durmam com deus = -2
deus te acompanhe = -2
deus lhe pague = -2
deus e maior = -1
se deus quiser = -1
gracas a deus = -1
graças a deus = -1
deus e fiel
deus e bom
deus proverá
deus provera
deus e pai
com a graca de deus
pela graca de deus
na paz de cristo = -2
paz de cristo = -2
paz e bem = -2
paz do senhor = -2
a paz do senhor = -2
o senhor esteja convosco = -1
o senhor esteja com voces = -1
ele esta no meio de nos
ave maria puríssima = -2
ave maria purissima = -2
sem pecado concebida = -2
jesus maria e jose = -1
jmj
jornada mundial da juventude
jornada mundial
oremos
rezem por mim
reze por mim
rezem por nos
pecam a deus
peço oracoes
peco oracoes
pedido de oracao
pedidos de oracao
intencao
intencoes
intencoes de oracao
novena = 2
novenas
triduo
tríduo
quarenta horas
primeira sexta
primeiras sextas
primeiro sabado
primeiros sabados
devocao = 2
devocoes
devoto
devota
devotos
devocional
piedade
piedoso
piedosa
espiritualidade = 2
espiritual
vida espiritual
vida interior
direcao espiritual
diretor espiritual
acompanhamento espiritual
padre espiritual
discernimento
discernir
vontade de deus
santidade
chamado a santidade
chamado universal a santidade
caminho de santidade
imitacao de cristo = 2
kempis
tomas de kempis
combate espiritual
scupoli
filoteia
introducao a vida devota
sao francisco de sales
francisco de sales
salesianos
tratado do amor de deus
castelo interior
moradas
caminho de perfeicao
subida do monte carmelo
chama viva de amor
historia de uma alma
liturgia
ano liturgico = 2
tempo comum
tempo pascal
tempo do advento
tempo do natal
tempo da quaresma
solenidade
solenidades
memoria
memoria facultativa
memoria obrigatoria
dia santo
dia de guarda
dias de guarda
dia de preceito
preceito
preceito dominical
missa dominical
missa aos domingos
domingo
domingos
dia do senhor
descanso dominical
sabbath
sabatico
feriado religioso
feriados religiosos
corpus christi
todos os santos
finados
dia de finados
fieis defuntos
assuncao
imaculada
sao joao
sao pedro e sao paulo
dia de sao jose
dia de nossa senhora
12 de outubro
15 de agosto
8 de dezembro
25 de dezembro
1 de novembro
2 de novembro
`;

const MORALIDADE = `
moral
morais
moralidade = 2
moralismo
moralista
moralistas
imoral
imoralidade
amoral
amoralidade
etica
etico
eticos
antietico
etica das virtudes
etica aristotelica
etica a nicomaco
nicomaco
eudaimonia
felicidade
vida boa
boa vida
florescimento humano
telos
teleologia
teleologico
causa final
finalidade
fim ultimo
fim do homem
natureza humana = 2
natureza do homem
condicao humana
essencia humana
o que e o homem
pessoa humana
personalismo
personalista
mounier
maritain
jacques maritain
humanismo integral
gilson
etienne gilson
garrigou lagrange
garrigou-lagrange
pieper
josef pieper
macintyre = 2
alasdair macintyre
depois da virtude
after virtue
etica kantiana
imperativo categorico
deveres
deontologia
deontologico
utilitarismo = 2
utilitarista
utilitaristas
bentham
jeremy bentham
maior felicidade
maior bem para o maior numero
consequencialismo
consequencialista
os fins justificam os meios
fins e meios
meios justos
duplo efeito
principio do duplo efeito
mal menor
menor mal
mal maior
bem e mal = 2
bem e o mal
maldade
malicia
malvado
bondade
bondoso
benevolencia
benevolente
altruismo
altruista
egoismo
egoista
egoismo racional
a virtude do egoismo
autointeresse
interesse proprio
interesse pessoal
consciencia
consciencia moral
voz da consciencia
peso na consciencia
objecao de consciencia
liberdade de consciencia
culpado
culpabilidade
sentimento de culpa
remorso
vergonha
honra
honrado
honroso
desonra
desonrado
dignidade
indigno
indignidade
integridade
integro
honestidade = 2
honesto
honesta
desonestidade
desonesto
mentira
mentiroso
mentirosos
verdade
verdadeiro
verdadeira
veracidade
falsidade
falsificacao
enganar
enganacao
fraude
fraudar
fraudulento
roubo
roubar
ladrao
ladroes
furto
furtar
assalto
assaltante
assaltar
estelionato
golpe
golpista
cobiça
cobica
cobicar
inveja
invejoso
ganancia
ganancioso
avareza
avarento
mesquinho
mesquinhez
generosidade
generoso
generosa
doacoes
dizimo = 2
dízimo
dizimista
ofertas
esmola
esmolas
caridade
caritativo
caritas
obras de caridade
obras de misericordia
misericordia corporais
misericordia espirituais
dar de comer
vestir os nus
visitar os presos
abrigar os peregrinos
enterrar os mortos
filantropia
filantropo
filantropico
assistencia social
assistencialismo
ajuda ao proximo
proximo
amar o proximo
amor ao proximo
ama o teu proximo
amai vos uns aos outros
regra de ouro
faca aos outros
nao facas aos outros
amoroso
agape
eros
philia
storge
caritas
os quatro amores
quatro amores
amor de deus
amor a deus
amor proprio
amor romantico
apaixonado
desejos
luxuria
lascivia
lascivo
impudicicia
modestia
modesto
modesta
pudor
pudico
recato
decencia
decente
indecente
indecencia
obscenidade
obsceno
vulgaridade
promiscuidade
promiscuo
libertinagem
libertino
depravacao
depravado
perversao
perverso
pervertido
degeneracao
degenerado
degenerada
decadencia = 2
decadente
declinio
declinio moral
decadencia moral
crise moral
colapso moral
corrupcao moral
corrupcao dos costumes
costumes = 2
bons costumes
maus costumes
moral e bons costumes
etiqueta
educacao
bem educado
mal educado
respeito
respeitar
respeitoso
desrespeito
desrespeitar
desrespeitoso
cortesia
gentileza
civilidade
civilizado
incivilidade
barbarie
barbaro
barbaros
selvageria
selvagem
brutalidade
crueldade
sadismo
sadico
violencia
violento
nao violencia
pacifismo
pacifista
pacifico
pacificar
guerra justa = 2
teoria da guerra justa
jus ad bellum
jus in bello
legitima defesa = 2
autodefesa
defesa propria
direito de defesa
porte de arma
porte de armas
posse de arma
posse de armas
armas
arma
armamento
armamentismo
armamentista
desarmamento = 2
desarmamentismo
desarmamentista
estatuto do desarmamento
cac
cacs
atirador
colecionador
armas de fogo
segunda emenda
direito a armas
direito as armas
cidadao armado
cidadao de bem
bandido bom
bandido
bandidos
bandidagem
criminoso
criminosos
crime
crimes
criminalidade
violencia urbana
homicidio
homicidios
assassinato
assassino
assassinar
latrocinio
sequestro
trafico
trafico de drogas
traficante
traficantes
faccao
faccoes
pcc
comando vermelho
milicia
milicias
miliciano
policia
policial
policiais
policia militar
policia civil
policia federal
seguranca publica = 2
seguranca
inseguranca
ordem publica
lei e ordem
tolerancia zero
punicao
punir
punitivismo
punitivista
prisao
prisoes
presidiario
presidiarios
sistema prisional
sistema carcerario
carcere
encarceramento
encarceramento em massa
superlotacao
progressao de regime
saidinha
saida temporaria
audiencia de custodia
reincidencia
reincidente
ressocializacao
reabilitacao
justica restaurativa
impunidade
maioridade penal = 2
reducao da maioridade
menor infrator
menores infratores
estatuto da crianca
drogas
maconha = 2
cannabis
legalizacao da maconha
legalizacao das drogas
descriminalizacao
descriminalizar
legalizar
legalizacao
guerra as drogas = 2
proibicionismo
proibicionista
reducao de danos
cracolandia
cocaina
alcoolismo
embriaguez
cigarro
vicio
vicios
viciado
viciados
dependencia quimica
dependente quimico
jogos de azar
apostas
cassino
cassinos
loteria
jogo do bicho
prostituicao = 2
prostituta
prostitutas
profissional do sexo
trabalho sexual
regulamentacao da prostituicao
onlyfans
sugar daddy
pornografia
industria porno
objetificacao
objetificar
hipersexualizacao
sexualizacao precoce
casamento
casados
solteiro
solteiros
solteirice
namorar
namorado
namorada
ficante
relacionamento
relacionamentos
relacionamento aberto
poliamor
poligamia
monogamia
monogamico
traicao
infidelidade
fidelidade
compromisso
comprometimento
lealdade
desleal
deslealdade
confianca
confiavel
desconfianca
amizade
verdadeira amizade
inimigo
inimigos
inimizade
odio
ressentimento
ressentido
vinganca
vingativo
justica com as proprias maos
olho por olho
lei de taliao
taliao
perdao
perdoar
reconciliacao
reconciliar
compaixao
compassivo
empatia
empatico
solidariedade
solidario
fraternidade = 2
fraterno
irmandade
comunidade
comunitario
comunitarismo
comunitarista
vizinho
vizinhanca
familia
domestico
tarefas domesticas
dona de casa
do lar
mae de familia
pai de familia
chefe de familia
provedor
provedora
papel do homem
papel da mulher
masculinidade = 2
masculino
homem de verdade
homem de bem
virilidade
viril
feminilidade
feminino
mulher de verdade
mulher virtuosa
feminismo = 2
feminista = 2
feminismo radical
radfem
patriarcado = 2
patriarcal
machismo = 2
machista
misoginia
misogino
misandria
red pill
redpill
mgtow
incel
manosfera
casamento tradicional
papeis de genero
diferenca entre homem e mulher
homem e mulher
complementaridade
complementares
igualdade = 2
igualitarismo = 2
igualitario
igualitaria
igualdade de genero
igualdade de oportunidades
igualdade de resultados
igualdade perante a lei
igualdade formal
igualdade material
equidade
equidade de genero
justica social = 2
justiça social
justica distributiva
justica comutativa
justica legal
justica retributiva
injustica
injusto
injusta
justo e injusto
meritocracia = 2
meritocratico
merito
meritorio
esforco
esforcado
trabalho duro
disciplina
disciplinado
indisciplina
autodisciplina
dominio proprio
autocontrole
autodominio
temperanca
moderacao
moderado
equilibrio
sobriedade
frugalidade
simplicidade
simples
vida simples
minimalismo
minimalista
pobreza voluntaria
desapego
materialismo
consumismo
hedonismo = 2
hedonista
hedonistas
prazeres
busca do prazer
gratificacao instantanea
gratificacao adiada
sacrificio
sacrificios
sacrificar
abnegacao
renuncia
renunciar
mortificacao
ascese
ascetismo
ascetico
asceta
sofrimento
cruz de cada dia
carregar a cruz
oferecer o sofrimento
sentido do sofrimento
sentido da vida = 2
sentido
proposito
proposito de vida
vocacao
missao de vida
frankl
viktor frankl
em busca de sentido
logoterapia
niilismo
vazio existencial
angustia
desespero
ansiedade
depressao
saude mental
terapia
psicologia
psicologo
psicanalise
freud
jung
jordan peterson = 2
peterson
12 regras para a vida
12 regras
arrume seu quarto
arruma a cama
lagosta
mortalidade
imortal
imortalidade
alma
almas
alma imortal
imortalidade da alma
espirito
espiritos
corpo e alma
corpo alma e espirito
dualismo
dualista
hilemorfismo
alma e forma do corpo
vida apos a morte
vida depois da morte
outro lado
pos morte
pos-morte
ceu e inferno
ceu ou inferno
julgamento
julgamento particular
julgamento final
memento mori
lembra te da morte
vanitas
vaidade
vaidade das vaidades
tudo e vaidade
efemero
passageiro
eternidade = 2
infinito
transcendencia = 2
transcendente
transcender
imanencia
imanente
sagrado = 2
sagrada
sacralidade
profano
profanacao
profanar
sacrilegio
sacrilego
blasfemia = 2
blasfemo
blasfemar
blasfemia contra o espirito
heresia
apostasia
sacrilegio
simonia
nepotismo
escandalo = 2
escandalos
escandalizar
escandaloso
pedra de tropeco
mau exemplo
bom exemplo
exemplo
exemplar
modelo de vida
testemunho de vida
coerencia = 2
coerente
incoerencia
incoerente
hipocrisia = 2
hipocrita
hipocritas
farisaismo
fariseu
fariseus
sepulcro caiado
sepulcros caiados
puritanismo
puritano
puritanos
moralismo
moralista
legalismo
legalista
rigorismo
rigorista
laxismo
laxista
permissividade
permissivo
permissivismo
liberalidade
licenciosidade
licencioso
libertinagem
tudo pode
vale tudo
anything goes
ninguem e dono de ninguem
meu corpo minhas regras
meu corpo
minhas regras
autonomia = 2
autonomo
autonomia individual
autonomia da vontade
autodeterminacao
liberdade absoluta
liberdade sem limites
liberdade e responsabilidade
responsabilidade
responsavel
irresponsavel
irresponsabilidade
responsabilidade individual = 2
responsabilidade pessoal
assumir a responsabilidade
culpa e do sistema
vitimismo = 2
vitimista
vitimas
cultura do vitimismo
mentalidade de vitima
coitadismo
coitadinho
mimimi
fragilidade
geracao floco de neve
floco de neve
snowflake
safe space
espaco seguro
gatilho
gatilhos
trigger
microagressao
microagressoes
opressao = 2
opressor
opressores
oprimido
oprimidos
opressor e oprimido
teoria critica da raca
crt
racismo = 2
racista
racistas
antirracismo
antirracista
racismo estrutural
racismo reverso
raca
racas
racial
etnia
etnico
branquitude
privilegio branco
supremacia branca
supremacista
nazismo = 2
nazista = 2
nazistas
hitler = 2
adolf hitler
terceiro reich
reich
holocausto = 2
shoah
auschwitz
campos de concentracao
campo de concentracao
genocidio = 2
genocida
limpeza etnica
extermínio
exterminio
fascismo = 2
fascista = 2
fascistas
mussolini
duce
integralismo
integralista
plinio salgado
escravidao = 2
escravo
escravos
escravista
escravocrata
abolicao
abolicionismo
abolicionista
abolicionismo penal
lei aurea
princesa isabel
trafico negreiro
reparacao historica
reparacoes
divida historica
cotas raciais
acao afirmativa
acoes afirmativas
discriminacao = 2
discriminar
discriminatorio
preconceito = 2
preconceituoso
intolerancia
intolerante
xenofobia
xenofobo
homofobia = 2
homofobico
transfobia
transfobico
lgbtfobia
gordofobia
capacitismo
etarismo
misoginia
sexismo
sexista
assedio
assedio sexual
assedio moral
estupro
estuprador
cultura do estupro
consentimento
violencia contra a mulher
violencia domestica
feminicidio
lei maria da penha
maria da penha
imigracao = 2
imigrante
imigrantes
imigracao ilegal
imigrante ilegal
imigrantes ilegais
migracao
migrante
migrantes
refugiado
refugiados
fronteira
fronteiras
fronteiras abertas
open borders
controle de fronteira
deportacao
deportar
deportados
assimilacao
integracao
multiculturalismo = 2
multicultural
diversidade
diverso
inclusao
inclusivo
inclusiva
diversidade equidade e inclusao
representatividade
representativo
lugar de fala
apropriacao cultural
cultura
cultural
culturas
civilizacao
civilizacoes
choque de civilizacoes
huntington
ocidente = 2
ocidental
valores ocidentais
oriente
oriental
islamismo = 2
islam
islamico
islamica
muculmano = 2
muculmanos
muçulmano
mesquita
alcorao
corao
maome
profeta maome
sharia
xaria
jihad
jihadista
jihadismo
islamismo radical
islamismo politico
terrorismo islamico
estado islamico
isis
al qaeda
taliba
hezbollah
sunita
xiita
sufi
sufismo
burca
hijab
veu islamico
niqab
judaismo = 2
judeu = 2
judeus
judia
judias
judaico
judaica
israel
israelense
sionismo
sionista
antissemitismo = 2
antissemita
antisemitismo
antisemita
sinagoga
rabino
tora
talmude
cabala
kabbalah
ortodoxo judeu
judeu ortodoxo
hassidico
povo escolhido
povo de deus
alianca
antiga alianca
nova alianca
abraao
jose do egito
moises = 2
dez mandamentos = 2
mandamentos = 2
mandamento
decalogo
tabuas da lei
sinai
monte sinai
exodo
terra prometida
rei davi
salomao
rei salomao
templo de jerusalem
templo de salomao
muro das lamentacoes
noe
arca de noe
diluvio
adao e eva
jardim do eden
eden
fruto proibido
serpente
caim
caim e abel
babel
torre de babel
sodoma
gomorra
sodoma e gomorra
hinduismo
hindu
hindus
brahma
vishnu
shiva
krishna
karma
carma
darma
dharma
reencarnacao = 2
reencarnar
vidas passadas
budismo = 2
budista
budistas
buda
nirvana
iluminacao
meditacao budista
zen
zen budismo
dalai lama
tibete
taoismo
confucionismo
confucio
xintoismo
sikh
sikhismo
jainismo
zoroastrismo
paganismo = 2
pagao
pagaos
neopaganismo
neopagao
wicca
bruxaria = 2
bruxa
bruxas
bruxo
feiticaria
feiticeiro
feitico
feiticos
magia
magia negra
magia branca
ocultismo = 2
ocultista
esoterismo = 2
esoterico
esoterica
misticismo
nova era = 2
new age
astrologia = 2
astrologo
horoscopo
signo
signos
mapa astral
tarot
taro
cartomante
vidente
adivinhacao
adivinho
oraculo
cristais
energias
vibracao
vibracoes
chakra
chakras
reiki
yoga
ioga
mindfulness
meditacao transcendental
lei da atracao
o segredo
manifestacao
manifestar
universo conspira
o universo
espiritismo = 2
espirita = 2
espiritas
kardec
allan kardec
kardecismo
kardecista
livro dos espiritos
evangelho segundo o espiritismo
chico xavier
psicografia
medium
mediunidade
sessao espirita
centro espirita
mesa branca
umbanda = 2
umbandista
candomble = 2
candomblecista
orixa
orixas
iemanja
oxala
ogum
exu
pomba gira
pombagira
terreiro
terreiros
mae de santo
pai de santo
macumba
macumbeiro
despacho
oferenda
oferendas
religioes de matriz africana
matriz africana
afro brasileira
afro-brasileira
sincretismo religioso
intolerancia religiosa
liberdade religiosa = 2
liberdade de culto
liberdade de crenca
perseguicao religiosa
religiao
religioes
religioso
religiosa
religiosidade
crenca
crencas
crente
fe
ter fe
sem fe
gente de fe
pessoa de fe
homem de fe
mulher de fe
espiritualidade
espiritual
sobrenatural = 2
natural e sobrenatural
milagre
milagroso
mistério
misterio
misterios
misterio da fe
transcendente
existencia de deus = 2
deus existe = 2
deus nao existe = 2
prova da existencia de deus
provas da existencia de deus
argumento cosmologico
argumento teleologico
argumento moral
argumento ontologico
primeiro motor
motor imovel
causa primeira
causa incausada
ser necessario
design inteligente
criacionismo = 2
criacionista
criacao
criador
criatura
criaturas
evolucao
evolucionismo
darwin
darwinismo
darwinista
teoria da evolucao
selecao natural
big bang
origem do universo
origem da vida
ciencia e fe = 2
ciencia e religiao
fe e razao = 2
fe e ciencia
razao e fe
galileu
caso galileu
giordano bruno
copernico
lemaitre
georges lemaitre
padre lemaitre
mendel
gregor mendel
teodiceia = 2
problema do mal = 2
se deus existe por que
por que deus permite
deus permite o mal
mal no mundo
sofrimento dos inocentes
epicuro
paradoxo de epicuro
onipotente
onipotencia
onisciente
onisciencia
onipresente
onipresenca
atributos de deus
deus e amor
deus e justo
deus e bom
deus castiga
castigo divino
ira de deus
temor de deus
temor a deus
santo temor
reverencia
respeito a deus
irreverencia
apologetica = 2
apologeta
apologista
apologetica catolica
defesa da fe
defender a fe
padre paulo ricardo
apostolado veritatis
veritatis
apostolado da fe
podcast
podcast catolico
youtuber catolico
influencer catolico
catequese online
catolico na internet
carismatico
tradicional
tradicionalista
`;

// Saudações e fórmulas soltas puxam para baixo: só valem quando dirigidas ao bot
// (reply/menção), e aí nem passam pelo juiz.
const SAUDACOES = `
bom dia = -2
boa tarde = -2
boa noite = -2
tudo bem = -2
tudo bom = -2
boa semana = -2
bom fim de semana = -2
bom final de semana = -2
`;

export const DICIONARIO = {
  austriaca_ancap: AUSTRIACA_ANCAP,
  economia: ECONOMIA,
  politica: POLITICA,
  catolicismo: CATOLICISMO,
  moralidade_religiao: MORALIDADE,
  saudacoes: SAUDACOES,
};

// Converte os blocos de texto em entradas { term, weight } sem duplicatas.
export function parseDictionary(blocks = DICIONARIO) {
  const seen = new Map();
  for (const text of Object.values(blocks)) {
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const [termPart, weightPart] = line.split('=');
      const term = termPart.trim();
      const weight = weightPart == null ? 1 : Number(weightPart.trim());
      if (!term || Number.isNaN(weight)) continue;
      // repetido: fica o maior peso
      if (!seen.has(term) || seen.get(term) < weight) seen.set(term, weight);
    }
  }
  return [...seen].map(([term, weight]) => ({ term, weight }));
}
