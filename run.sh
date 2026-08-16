#!/bin/bash
clear

if [ -n "$1" ]; then
    choice="$1"
else
    while true; do
        echo -e "\033[1;33m-----------------------------------------------\033[0m"
        echo -e "                    \033[1;36mdango\033[0m"
        echo -e "\033[1;33m-----------------------------------------------\033[0m"
        echo -e "    \033[1;34mhttps://github.com/serifpersia/dango\033[0m"
        echo -e "\033[1;33m-----------------------------------------------\033[0m"
        echo

        echo -e "\033[1;33mPlease choose a mode to run:\033[0m"
        echo "  1) Development (Install all deps, build, and run hot-reload)"
        echo "  2) Production  (Run pre-built version)"
        echo

        read -p "Enter your choice (1 or 2): " choice
        echo

        if [ "$choice" == "1" ] || [ "$choice" == "2" ]; then
            break
        else
            echo -e "\033[1;31mInvalid choice. Please try again.\033[0m"
            sleep 2
            clear
        fi
    done
fi

if [ "$choice" == "1" ]; then
    echo -e "\033[1;36mRunning in DEVELOPMENT mode... \033[0m"
    echo
    echo "--> Installing all dependencies..."
    npm install
    echo
    echo "--> Starting Development Server..."
    node orchestrator.js dev

elif [ "$choice" == "2" ]; then
    echo -e "\033[1;32mRunning in PRODUCTION mode... \033[0m"
    echo

    if [ -f "server/dist/server.js" ] && [ -d "client/dist" ]; then
        echo "--> Pre-built files found. Skipping build..."
    else
        echo "--> Build missing. Installing and Building..."
        npm install
        if [ $? -ne 0 ]; then
            echo -e "\033[1;31mError: Install failed!\033[0m"
            read -p "Press Enter to exit..."
            exit 1
        fi
        npm run build
        if [ $? -ne 0 ]; then
            echo -e "\033[1;31mError: Build failed!\033[0m"
            read -p "Press Enter to exit..."
            exit 1
        fi
    fi

    echo "--> Ensuring Production Dependencies for server..."
    (cd server && npm install --omit=dev)

    echo
    echo "--> Starting application in production mode..."
    node orchestrator.js prod
fi