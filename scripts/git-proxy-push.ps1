$ErrorActionPreference = 'Stop'

$proxy = 'http://127.0.0.1:7890'

git -c http.proxy=$proxy -c https.proxy=$proxy push @args

