@echo off
title FinControl Pro

echo.
echo  ==========================================
echo   FinControl Pro - Iniciando...
echo   Backend FastAPI + SQLite
echo  ==========================================
echo.

:: Verifica Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERRO] Python nao encontrado.
    echo  Instale em: https://www.python.org/downloads/
    echo  Marque "Add Python to PATH" durante a instalacao.
    echo.
    pause
    exit /b 1
)

:: Instala dependencias se ausentes
pip show fastapi >nul 2>&1
if %errorlevel% neq 0 (
    echo  Instalando dependencias pela primeira vez...
    echo.
    pip install fastapi "uvicorn[standard]" python-multipart "python-jose[cryptography]" passlib
    if %errorlevel% neq 0 (
        echo.
        echo  [ERRO] Falha ao instalar dependencias.
        pause
        exit /b 1
    )
    echo.
    echo  Dependencias instaladas!
    echo.
)

:: Libera porta 8080 se estiver ocupada
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":8080 "') do (
    taskkill /PID %%a /F >nul 2>&1
)

:: Inicia servidor em segundo plano
echo  Iniciando servidor em http://localhost:8080 ...
start "" /B python -m uvicorn main:app --host 127.0.0.1 --port 8080

:: Aguarda servidor responder
echo  Aguardando servidor ficar pronto...
set /a tentativas=0

:AGUARDA
timeout /t 1 /nobreak >nul
set /a tentativas+=1
curl -s http://localhost:8080/docs >nul 2>&1
if %errorlevel% equ 0 goto PRONTO
if %tentativas% lss 15 goto AGUARDA
echo  [AVISO] Servidor demorou. Abrindo navegador mesmo assim...
goto ABRIR

:PRONTO
echo  Servidor pronto!
echo.

:ABRIR
start "" "%~dp0index.html"

echo.
echo  ==========================================
echo   Sistema rodando!
echo.
echo   API:   http://localhost:8080
echo   Banco: fincontrol.db
echo.
echo   Logins:
echo     admin    / admin123
echo     gerente  / gerente123
echo     operador / op123
echo.
echo   Feche esta janela para ENCERRAR
echo  ==========================================
echo.

:LOOP
timeout /t 5 /nobreak >nul
curl -s http://localhost:8080/docs >nul 2>&1
if %errorlevel% neq 0 (
    echo  Servidor encerrado.
    goto FIM
)
goto LOOP

:FIM
echo.
pause